import csv
import io
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ZIP_PATH = ROOT / "survey data.zip"


with zipfile.ZipFile(ZIP_PATH) as zf:
    name = zf.namelist()[0]
    text = zf.read(name).decode("utf-8-sig")

rows = list(csv.reader(io.StringIO(text)))
print("file:", name)
print("rows:", len(rows))
print("columns:", len(rows[0]) if rows else 0)
for idx, row in enumerate(rows[:8], start=1):
    print("=" * 80)
    print("row", idx)
    for col_idx, value in enumerate(row[:45], start=1):
        print(col_idx, repr(value[:120]))
