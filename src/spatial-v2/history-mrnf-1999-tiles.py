"""Serve Web Mercator XYZ PNG tiles from one proven 1999 MRNF GeoTIFF.

Uses the file CRS WKT and a proj string for Web Mercator. Does not use EPSG
codes, because this machine's PROJ database can be the PostgreSQL copy.
"""

from __future__ import annotations

import argparse
import math
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from urllib.parse import urlparse

import numpy as np
import rasterio
from PIL import Image
from rasterio.crs import CRS
from rasterio.warp import Resampling, reproject

MERCATOR = CRS.from_string(
    "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 "
    "+k=1 +units=m +nadgrids=@null +wktext +no_defs +type=crs"
)
ORIGIN = 20037508.342789244
TILE = 256
LOCK = threading.Lock()
DATASET = None
SRC_MASK = None


def tile_bounds(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    n = 2 ** z
    size = (ORIGIN * 2) / n
    xmin = -ORIGIN + x * size
    ymax = ORIGIN - y * size
    return xmin, ymax - size, xmin + size, ymax


def render_tile(z: int, x: int, y: int) -> bytes:
    xmin, ymin, xmax, ymax = tile_bounds(z, x, y)
    dst = np.zeros((TILE, TILE), dtype=np.uint8)
    alpha = np.zeros((TILE, TILE), dtype=np.uint8)
    dst_transform = rasterio.transform.from_bounds(xmin, ymin, xmax, ymax, TILE, TILE)
    with LOCK:
        reproject(
            source=rasterio.band(DATASET, 1),
            destination=dst,
            src_transform=DATASET.transform,
            src_crs=DATASET.crs,
            dst_transform=dst_transform,
            dst_crs=MERCATOR,
            resampling=Resampling.bilinear,
        )
        reproject(
            source=SRC_MASK,
            destination=alpha,
            src_transform=DATASET.transform,
            src_crs=DATASET.crs,
            dst_transform=dst_transform,
            dst_crs=MERCATOR,
            resampling=Resampling.nearest,
        )
    gray = np.where(alpha > 0, dst, 0).astype(np.uint8)
    rgba = np.dstack((gray, gray, gray, np.where(alpha > 0, 255, 0).astype(np.uint8)))
    buffer = BytesIO()
    Image.fromarray(rgba, mode="RGBA").save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def do_GET(self):
        path = urlparse(self.path).path.strip("/")
        parts = path.split("/")
        if len(parts) != 3:
            self.send_error(404)
            return
        try:
            z = int(parts[0])
            x = int(parts[1])
            y = int(parts[2].removesuffix(".png"))
        except ValueError:
            self.send_error(400)
            return
        if not (0 <= z <= 22 and x >= 0 and y >= 0):
            self.send_error(400)
            return
        try:
            png = render_tile(z, x, y)
        except Exception as error:
            sys.stderr.write(f"tile {z}/{x}/{y} failed: {error}\n")
            sys.stderr.flush()
            self.send_error(500)
            return
        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(png)))
        self.send_header("Cache-Control", "private, max-age=120")
        self.end_headers()
        self.wfile.write(png)


def main() -> int:
    global DATASET, SRC_MASK
    parser = argparse.ArgumentParser()
    parser.add_argument("--tiff", required=True)
    parser.add_argument("--port", type=int, default=0)
    args = parser.parse_args()
    tiff = Path(args.tiff)
    if not tiff.is_file():
        sys.stderr.write(f"missing GeoTIFF: {tiff}\n")
        return 2
    DATASET = rasterio.open(tiff)
    SRC_MASK = np.full((DATASET.height, DATASET.width), 255, dtype=np.uint8)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    port = server.server_address[1]
    sys.stdout.write(f"READY {port}\n")
    sys.stdout.flush()
    try:
        server.serve_forever()
    finally:
        DATASET.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
