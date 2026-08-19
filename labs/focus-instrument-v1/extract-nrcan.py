"""Clip NRCan Optimized Buildings (GeoParquet) to downtown Montréal.

Does not download the nationwide file. Uses GeoParquet bbox columns for
predicate pushdown over HTTP range requests.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import duckdb
from pyproj import Transformer
from shapely import wkb
from shapely.ops import transform as shp_transform

ROOT = Path(__file__).parent
OUT = ROOT / "public" / "data" / "nrcan-buildings.geojson"
URL = (
    "https://ftp.maps.canada.ca/pub/nrcan_rncan/extraction/auto_building/"
    "auto_building_opti_2/auto_building_opti_2.parquet"
)
# Downtown Ville-Marie: PVM, Gare Centrale, 1000 de La Gauchetière, Square Victoria
XMIN, YMIN, XMAX, YMAX = -73.5780, 45.4950, -73.5540, 45.5100
NATIVE_CRS = "EPSG:4617"
WEB_CRS = "EPSG:4326"

SOURCE_FIELDS = [
    "feature_id",
    "md_id",
    "acqtech",
    "acqtech_en",
    "provider",
    "provideren",
    "datemin",
    "datemax",
    "haccmin",
    "haccmax",
    "vaccmin",
    "vaccmax",
    "heightmin",
    "heightmax",
    "elevmin",
    "elevmax",
    "bldgarea",
    "comment",
    "qltylvl",
    "qltylvl_en",
    "md_id_src",
]


def geom_to_wgs84(geom):
    transformer = Transformer.from_crs(NATIVE_CRS, WEB_CRS, always_xy=True)

    def project(x, y, z=None):
        xx, yy = transformer.transform(x, y)
        return (xx, yy) if z is None else (xx, yy, z)

    return shp_transform(project, geom)


def json_safe(value):
    if value is None:
        return None
    if hasattr(value, "item"):
        value = value.item()
    if isinstance(value, bytes):
        return None
    if isinstance(value, float) and value != value:  # NaN
        return None
    return value


def main():
    print("NRCan optimized GeoParquet bbox clip", flush=True)
    print(f"  url  {URL}", flush=True)
    print(f"  bbox {XMIN},{YMIN},{XMAX},{YMAX}", flush=True)
    started = time.time()
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute("SET enable_progress_bar=false;")
    con.execute("SET http_timeout=180000;")
    sql = f"""
      SELECT
        feature_id, md_id, acqtech, acqtech_en, provider, provideren,
        datemin, datemax, haccmin, haccmax, vaccmin, vaccmax,
        heightmin, heightmax, elevmin, elevmax, bldgarea, comment,
        qltylvl, qltylvl_en, md_id_src, geometry
      FROM read_parquet('{URL}')
      WHERE geometry_bbox.xmin <= {XMAX}
        AND geometry_bbox.xmax >= {XMIN}
        AND geometry_bbox.ymin <= {YMAX}
        AND geometry_bbox.ymax >= {YMIN}
    """
    print("querying remote GeoParquet…", flush=True)
    rel = con.execute(sql)
    columns = [d[0] for d in rel.description]
    rows = rel.fetchall()
    print(f"rows {len(rows)} in {time.time() - started:.1f}s", flush=True)
    if not rows:
        print("ERROR: no NRCan optimized footprints in downtown Montréal bbox", file=sys.stderr)
        sys.exit(2)

    features = []
    skipped = 0
    for row in rows:
        record = dict(zip(columns, row))
        raw = record.get("geometry")
        if not raw:
            skipped += 1
            continue
        try:
            geom = wkb.loads(bytes(raw))
        except Exception:
            skipped += 1
            continue
        if geom.is_empty:
            skipped += 1
            continue
        geom = geom_to_wgs84(geom)
        if geom.geom_type not in ("Polygon", "MultiPolygon"):
            skipped += 1
            continue
        props = {key: json_safe(record.get(key)) for key in SOURCE_FIELDS}
        fid = props.get("feature_id") or f"nrcan-{len(features)}"
        props.update({
            "objectId": f"nrcan/{fid}",
            "objectKind": "building",
            "source": "NRCan Automatically Extracted Buildings",
            "sourceLayer": "Optimized Buildings Layer (auto_building_opti_2)",
            "sourceUuid": "7a5cda52-c7df-427f-9ced-26f19a8a64d6",
            "sourceCrs": NATIVE_CRS,
        })
        features.append({
            "type": "Feature",
            "id": f"nrcan/{fid}",
            "properties": props,
            "geometry": json.loads(json.dumps(geom.__geo_interface__)),
        })

    collection = {
        "type": "FeatureCollection",
        "name": "NRCan Optimized Buildings — Montréal downtown clip",
        "attribution": "NRCan Automatically Extracted Buildings · Optimized Buildings Layer",
        "source": {
            "dataset": "Automatically Extracted Buildings",
            "uuid": "7a5cda52-c7df-427f-9ced-26f19a8a64d6",
            "layer": "Optimized Buildings Layer auto_building_opti_2",
            "distribution": "GeoParquet vector",
            "url": URL,
            "nativeCrs": NATIVE_CRS,
            "outputCrs": WEB_CRS,
            "bbox": [XMIN, YMIN, XMAX, YMAX],
            "featureCount": len(features),
            "skipped": skipped,
        },
        "features": features,
    }
    tmp = OUT.with_suffix('.geojson.tmp')
    tmp.write_text(json.dumps(collection, ensure_ascii=False), encoding="utf-8")
    tmp.replace(OUT)
    print(f"wrote {OUT}  features={len(features)} skipped={skipped} bytes={OUT.stat().st_size}", flush=True)


if __name__ == "__main__":
    main()
