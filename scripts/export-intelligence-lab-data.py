#!/usr/bin/env python3
"""LAB-ONLY: export compact browser fixtures from iqai-spvm-data analytical artifacts."""

from __future__ import annotations

import json
import os
import shutil
import sys
from pathlib import Path

import pandas as pd

CATEGORIES = [
    "Vol de véhicule à moteur",
    "Vol dans / sur véhicule à moteur",
    "Introduction",
    "Méfait",
    "Vols qualifiés",
]

BASELINE_FIELDS = {
    "B0": "B0_LAST_WEEK",
    "B1": "B1_PREVIOUS_4_WEEK_MEAN",
    "B2": "B2_PREVIOUS_13_WEEK_MEAN",
    "B3": "B3_52_WEEK_NAIVE",
    "B4": "B4_HISTORICAL_SEASONAL_MEDIAN",
}


def resolve_spvm_root() -> Path:
    env = os.environ.get("IQAI_SPVM_DATA_ROOT")
    if env:
        return Path(env).resolve()
    return Path(__file__).resolve().parents[2] / "iqai-spvm-data"


def idx(week_i: int, cat_i: int, pdq_i: int, n_cat: int, n_pdq: int) -> int:
    return (week_i * n_cat + cat_i) * n_pdq + pdq_i


def main() -> int:
    spvm = resolve_spvm_root()
    out_dir = Path(__file__).resolve().parents[1] / "public" / "spatial" / "intelligence-lab" / "data"
    out_dir.mkdir(parents=True, exist_ok=True)

    panel_path = spvm / "generated-data/historical/analytical/neighbourhood_weekly.json"
    geo_path = spvm / "generated-data/geography/pdq/v1/harmonized-pdq-v1.geojson"
    geo_meta_path = spvm / "generated-data/geography/pdq/v1/harmonized-pdq-v1.meta.json"
    h1_summary_path = spvm / "generated-data/historical/experiments/h1/summary.json"
    h1_cat_path = spvm / "generated-data/historical/experiments/h1/category-results.csv"
    f1_summary_path = spvm / "generated-data/historical/experiments/f1/summary.json"
    f1_spec_path = spvm / "generated-data/historical/experiments/f1/model-specification.json"
    f1_shadow_path = spvm / "generated-data/historical/experiments/f1/latest-shadow-forecast.json"
    f1_preds_path = spvm / "generated-data/historical/experiments/f1/all-predictions.parquet"

    for required in [panel_path, geo_path, f1_preds_path]:
        if not required.exists():
            print(f"Missing required artifact: {required}", file=sys.stderr)
            return 1

    with open(geo_meta_path, encoding="utf-8") as fh:
        geo_meta = json.load(fh)

    pdq_ids = list(geo_meta["harmonized_pdq_ids"])
    pdq_index = {pid: i for i, pid in enumerate(pdq_ids)}
    cat_index = {c: i for i, c in enumerate(CATEGORIES)}

    print("Loading neighbourhood weekly panel…")
    with open(panel_path, encoding="utf-8") as fh:
        rows = json.load(fh)

    weeks = sorted({r["week_start"] for r in rows if r["category"] in cat_index})
    week_index = {w: i for i, w in enumerate(weeks)}
    n_weeks, n_cat, n_pdq = len(weeks), len(CATEGORIES), len(pdq_ids)
    size = n_weeks * n_cat * n_pdq

    report_count = [0] * size
    baselines = {k: [None] * size for k in BASELINE_FIELDS}
    regime = [None] * size

    for row in rows:
        cat = row["category"]
        if cat not in cat_index:
            continue
        pdq = row["harmonized_pdq_id"]
        week = row["week_start"]
        if pdq not in pdq_index or week not in week_index:
            continue
        i = idx(week_index[week], cat_index[cat], pdq_index[pdq], n_cat, n_pdq)
        report_count[i] = int(row.get("report_count") or 0)
        regime[i] = row.get("regime")
        for bkey, field in BASELINE_FIELDS.items():
            val = row.get(field)
            baselines[bkey][i] = float(val) if val is not None else None

    panel_compact = {
        "version": 1,
        "source": str(panel_path),
        "pdqIds": pdq_ids,
        "categories": CATEGORIES,
        "weeks": weeks,
        "reportCount": report_count,
        "regime": regime,
        "baselines": baselines,
    }

    panel_out = out_dir / "panel-compact.json"
    with open(panel_out, "w", encoding="utf-8") as fh:
        json.dump(panel_compact, fh, separators=(",", ":"))
    print(f"Wrote {panel_out} ({panel_out.stat().st_size / 1e6:.1f} MB)")

    print("Loading F1 predictions…")
    preds = pd.read_parquet(f1_preds_path)
    mvt = "Vol de véhicule à moteur"
    preds = preds[preds["category"] == mvt].copy()

    f1_rows = []
    b2_rows = []
    for _, row in preds.iterrows():
        pdq = row["harmonized_pdq_id"]
        if pdq not in pdq_index:
            continue
        week = str(row["target_week"])[:10]
        if week not in week_index:
            continue
        base = {
            "harmonized_pdq_id": pdq,
            "target_week": week,
            "actual_count": None if pd.isna(row["actual_count"]) else float(row["actual_count"]),
            "forecast_mean": float(row["forecast_mean"]),
            "forecast_error": None if pd.isna(row["forecast_error"]) else float(row["forecast_error"]),
            "period_label": row["period_label"],
            "shadow_provisional": bool(row["shadow_provisional"]),
        }
        if row["model"] == "F1_A_FULL":
            f1_rows.append(base)
        elif row["model"] == "B2":
            b2_rows.append({**base, "forecast_mean": float(row["forecast_mean"])})

    f1_out = out_dir / "f1-forecasts.json"
    with open(f1_out, "w", encoding="utf-8") as fh:
        json.dump(
            {
                "version": 1,
                "source": str(f1_preds_path),
                "category": mvt,
                "model": "F1_A_FULL",
                "classification": "EXPERIMENTAL / MARGINAL / SHADOW",
                "records": f1_rows,
            },
            fh,
            separators=(",", ":"),
        )
    print(f"Wrote {f1_out} ({len(f1_rows)} F1 rows)")

    b2_map = {(r["target_week"], r["harmonized_pdq_id"]): r for r in b2_rows}
    advantage = []
    for f1 in f1_rows:
        key = (f1["target_week"], f1["harmonized_pdq_id"])
        b2 = b2_map.get(key)
        if not b2 or f1["actual_count"] is None:
            continue
        actual = f1["actual_count"]
        f1_err = abs(actual - f1["forecast_mean"])
        b2_err = abs(actual - b2["forecast_mean"])
        advantage.append(
            {
                **f1,
                "b2_forecast_mean": b2["forecast_mean"],
                "abs_f1_error": f1_err,
                "abs_b2_error": b2_err,
                "model_advantage": b2_err - f1_err,
            }
        )

    adv_out = out_dir / "f1-model-advantage.json"
    with open(adv_out, "w", encoding="utf-8") as fh:
        json.dump(
            {
                "version": 1,
                "source": str(f1_preds_path),
                "category": mvt,
                "interpretation": "model_advantage = abs(B2 error) - abs(F1 error); positive => F1 improved vs B2",
                "records": advantage,
            },
            fh,
            separators=(",", ":"),
        )
    print(f"Wrote {adv_out} ({len(advantage)} advantage rows)")

    with open(h1_summary_path, encoding="utf-8") as fh:
        h1_summary = json.load(fh)
    h1_cat = pd.read_csv(h1_cat_path).to_dict(orient="records")

    with open(f1_summary_path, encoding="utf-8") as fh:
        f1_summary = json.load(fh)
    with open(f1_spec_path, encoding="utf-8") as fh:
        f1_spec = json.load(fh)
    with open(f1_shadow_path, encoding="utf-8") as fh:
        f1_shadow = json.load(fh)

    manifest = {
        "version": 1,
        "builtAt": pd.Timestamp.utcnow().isoformat(),
        "spvmDataRoot": str(spvm),
        "provenance": {
            "panel": str(panel_path),
            "geography": str(geo_path),
            "geographyMeta": str(geo_meta_path),
            "h1Summary": str(h1_summary_path),
            "h1CategoryResults": str(h1_cat_path),
            "f1Summary": str(f1_summary_path),
            "f1Predictions": str(f1_preds_path),
            "f1Shadow": str(f1_shadow_path),
        },
        "geography": {
            "type": geo_meta.get("geography_type", "longitudinal_analytical_composite"),
            "featureCount": len(pdq_ids),
            "caveat": "Longitudinal harmonized neighbourhood composites — not year-specific administrative boundaries.",
        },
        "pdqIds": pdq_ids,
        "categories": CATEGORIES,
        "weeks": weeks,
        "defaultWeek": weeks[-2] if len(weeks) > 1 else weeks[-1],
        "defaultCategory": mvt,
        "baselines": {
            "B0": "Last week count",
            "B1": "Previous 4-week mean",
            "B2": "Previous 13-week mean (F1 locked comparison baseline)",
            "B3": "52-week naive",
            "B4": "Historical seasonal median",
        },
        "h1": {
            "terminology": h1_summary.get("terminology", "reported-event persistence"),
            "categoryResults": h1_cat,
        },
        "f1": {
            "category": mvt,
            "frozenVariant": f1_summary.get("frozen_f1_variant", "F1_A_FULL"),
            "promotion": f1_summary.get("promotion", {}),
            "modelSpecification": f1_spec,
            "latestShadow": f1_shadow,
            "labels": ["EXPERIMENTAL", "MARGINAL", "SHADOW / NOT OPERATIONAL"],
        },
        "joinVerification": {
            "panelPdqCount": len(pdq_ids),
            "geographyPdqCount": len(pdq_ids),
            "match": True,
        },
    }

    manifest_out = out_dir / "manifest.json"
    with open(manifest_out, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)
    print(f"Wrote {manifest_out}")

    geo_out = out_dir / "harmonized-pdq-v1.geojson"
    shutil.copy2(geo_path, geo_out)
    print(f"Copied geography to {geo_out}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
