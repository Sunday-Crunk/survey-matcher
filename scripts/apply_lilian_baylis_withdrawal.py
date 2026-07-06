import io
import shutil
import tempfile
import zipfile
from pathlib import Path

import openpyxl


ROOT = Path(__file__).resolve().parents[1]
ZIP_PATH = ROOT / "school files.zip"
BACKUP_PATH = ROOT / "outputs" / "school files.before_lilian_baylis_withdrawal.zip"
TARGET = "Commando Joes studenst for LBTS (4).xlsx"
TARGET_ROW = 20


def main():
    BACKUP_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not BACKUP_PATH.exists():
        shutil.copy2(ZIP_PATH, BACKUP_PATH)

    with zipfile.ZipFile(ZIP_PATH, "r") as source_zip:
        workbook_bytes = source_zip.read(TARGET)
        workbook = openpyxl.load_workbook(io.BytesIO(workbook_bytes))
        worksheet = workbook["Pupil data"]

        before = [worksheet.cell(TARGET_ROW, col).value for col in range(1, 7)]
        if str(before[1]).strip().lower() != "eshan" or str(before[2]).strip().lower() != "imran":
            raise RuntimeError(f"Expected Eshan Imran at row {TARGET_ROW}, found {before}")

        worksheet.delete_rows(TARGET_ROW, 1)

        output = io.BytesIO()
        workbook.save(output)
        replacement_bytes = output.getvalue()

        with tempfile.NamedTemporaryFile(delete=False, suffix=".zip") as temp_file:
            temp_path = Path(temp_file.name)

        try:
            with zipfile.ZipFile(temp_path, "w", compression=zipfile.ZIP_DEFLATED) as out_zip:
                for item in source_zip.infolist():
                    data = replacement_bytes if item.filename == TARGET else source_zip.read(item.filename)
                    out_zip.writestr(item, data)
            shutil.move(str(temp_path), ZIP_PATH)
        finally:
            if temp_path.exists():
                temp_path.unlink()

    print("Deleted", TARGET, "row", TARGET_ROW)
    print("Removed:", before)
    print("Backup:", BACKUP_PATH)


if __name__ == "__main__":
    main()
