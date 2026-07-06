import argparse
import csv
import io
import json
import re
import zipfile
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ZIP = ROOT / "survey data.zip"
DEFAULT_OUTPUT = ROOT / "outputs"
DEDUPED_FULL_SURVEY_FILENAME = "deduped_survey_full_responses.csv"
LEGACY_DEDUPED_SURVEY_FILENAME = "deduped_survey_responses.csv"
MIN_YEAR = 2008
MAX_YEAR = 2016
MONTHS = {
    "january": 1,
    "jan": 1,
    "february": 2,
    "feb": 2,
    "march": 3,
    "mar": 3,
    "april": 4,
    "apr": 4,
    "may": 5,
    "june": 6,
    "jun": 6,
    "july": 7,
    "jul": 7,
    "august": 8,
    "aug": 8,
    "september": 9,
    "sept": 9,
    "sep": 9,
    "october": 10,
    "oct": 10,
    "november": 11,
    "nov": 11,
    "december": 12,
    "dec": 12,
}
MANUAL_IDENTIFIER_DECISIONS = {
    "R_8RgaqMJJhuqyZRT": "Accepted as matchable partial: Annabelle at Outwood Academy Shafton is unique in the roster despite missing birth month/year.",
}


def norm_text(value):
    if value is None:
        return ""
    text = str(value).strip().lower()
    text = re.sub(r"[_\n\r\t]+", " ", text)
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def norm_name(value):
    text = norm_text(value)
    return re.sub(r"[^a-z]", "", text)


def norm_school(value):
    text = norm_text(value)
    replacements = {
        " high school": " school",
        " secondary school": " school",
        " academy school": " academy",
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    text = re.sub(r"\b(the|a)\b", " ", text)
    text = re.sub(r"\b(high|secondary|school|academy|college|technology|for|girls|boys|and|sixth|form|centre)\b", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def parse_int(value):
    try:
        if str(value).strip() == "":
            return None
        return int(float(str(value).strip()))
    except ValueError:
        return None


def parse_bool(value):
    text = str(value).strip().lower()
    if text == "true":
        return True
    if text == "false":
        return False
    return None


def parse_birth_year(value):
    year = parse_int(value)
    if year is None:
        return "", "missing"
    if MIN_YEAR <= year <= MAX_YEAR:
        return year, "ok"
    return year, "implausible"


def parse_birth_month(value):
    raw = str(value).strip()
    if raw == "":
        return "", "missing"
    month_num = parse_int(raw)
    if month_num is not None:
        if 1 <= month_num <= 12:
            return month_num, "ok"
        return month_num, "invalid"
    month = MONTHS.get(raw.lower())
    if month:
        return month, "ok"
    return "", "invalid"


def read_survey_rows(zip_path):
    source_path = Path(zip_path)
    if source_path.suffix.lower() == ".csv":
        source_name = source_path.name
        text = source_path.read_text(encoding="utf-8-sig")
    else:
        with zipfile.ZipFile(zip_path) as zf:
            names = [name for name in zf.namelist() if name.lower().endswith(".csv")]
            if len(names) != 1:
                raise RuntimeError(f"Expected one CSV in survey zip, found {len(names)}")
            source_name = names[0]
            text = zf.read(source_name).decode("utf-8-sig")

    reader = csv.DictReader(io.StringIO(text))
    rows = []
    for row in reader:
        response_id = str(row.get("ResponseId", "")).strip()
        if response_id == "Response ID" or response_id.startswith('{"ImportId"'):
            continue
        rows.append(row)
    return source_name, rows


def classify_response(row):
    progress = parse_int(row.get("Progress"))
    finished = parse_bool(row.get("Finished"))
    consent = str(row.get("Consent", "")).strip().lower()
    has_identifiers = any(str(row.get(field, "")).strip() for field in ("Name", "School name", "DOB_1", "DOB_2"))
    if consent == "no":
        return "non_consent"
    if not has_identifiers and (progress or 0) < 50:
        return "low_progress_no_pupil_identifiers"
    if not has_identifiers:
        return "no_pupil_identifiers"
    if finished is False:
        return "partial_with_identifiers"
    return "usable_identifier_present"


def normalize_rows(rows):
    normalized = []
    for idx, row in enumerate(rows, start=1):
        year, year_status = parse_birth_year(row.get("DOB_1"))
        month, month_status = parse_birth_month(row.get("DOB_2"))
        progress = parse_int(row.get("Progress"))
        finished = parse_bool(row.get("Finished"))
        entered_name = str(row.get("Name", "")).strip()
        entered_school = str(row.get("School name", "")).strip()
        normalized.append(
            {
                "survey_row_index": idx,
                "response_id": str(row.get("ResponseId", "")).strip(),
                "start_date_raw": str(row.get("StartDate", "")).strip(),
                "end_date_raw": str(row.get("EndDate", "")).strip(),
                "recorded_date_raw": str(row.get("RecordedDate", "")).strip(),
                "status_raw": str(row.get("Status", "")).strip(),
                "progress": "" if progress is None else progress,
                "duration_seconds": str(row.get("Duration (in seconds)", "")).strip(),
                "finished": "" if finished is None else str(finished).lower(),
                "consent_raw": str(row.get("Consent", "")).strip(),
                "duplicate_respondent_raw": str(row.get("Q_DuplicateRespondent", "")).strip(),
                "entered_forename_raw": entered_name,
                "entered_forename_norm": norm_name(entered_name),
                "entered_school_raw": entered_school,
                "entered_school_norm": norm_school(entered_school),
                "birth_year_raw": str(row.get("DOB_1", "")).strip(),
                "birth_month_raw": str(row.get("DOB_2", "")).strip(),
                "birth_year": year,
                "birth_month": month,
                "birth_year_status": year_status,
                "birth_month_status": month_status,
                "birth_month_year": f"{year}-{int(month):02d}" if isinstance(year, int) and isinstance(month, int) and year_status == "ok" and month_status == "ok" else "",
                "response_class": classify_response(row),
                "manual_identifier_decision": MANUAL_IDENTIFIER_DECISIONS.get(str(row.get("ResponseId", "")).strip(), ""),
            }
        )
    return normalized


def write_csv(path, rows, fieldnames):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def top_values(rows, field, limit=50):
    counter = Counter(row[field] for row in rows if str(row[field]).strip())
    return [{"value": value, "count": count} for value, count in counter.most_common(limit)]


def build_decisions(rows):
    decisions = []
    ignored_classes = ("non_consent", "low_progress_no_pupil_identifiers", "no_pupil_identifiers")
    missing_name = [row for row in rows if row["response_class"] not in ignored_classes and not row["manual_identifier_decision"] and not row["entered_forename_norm"]]
    missing_school = [row for row in rows if row["response_class"] not in ignored_classes and not row["manual_identifier_decision"] and not row["entered_school_norm"]]
    missing_dob = [
        row
        for row in rows
        if row["response_class"] not in ignored_classes
        and not row["manual_identifier_decision"]
        and (row["birth_year_status"] != "ok" or row["birth_month_status"] != "ok")
    ]
    for decision_type, decision_needed, subset in [
        ("survey_missing_forename", "Decide whether these responses can be matched manually despite missing entered forename.", missing_name),
        ("survey_missing_school", "Decide whether these responses can be matched manually despite missing entered school.", missing_school),
        ("survey_missing_or_bad_birth_month_year", "Decide whether these responses can be matched manually despite missing/invalid birth month or year.", missing_dob),
    ]:
        if subset:
            decisions.append(
                {
                    "decision_type": decision_type,
                    "decision_needed": decision_needed,
                    "count": len(subset),
                    "evidence_sample": [
                        {
                            "response_id": row["response_id"],
                            "progress": row["progress"],
                            "finished": row["finished"],
                            "consent_raw": row["consent_raw"],
                            "entered_forename_raw": row["entered_forename_raw"],
                            "entered_school_raw": row["entered_school_raw"],
                            "birth_year_raw": row["birth_year_raw"],
                            "birth_month_raw": row["birth_month_raw"],
                            "response_class": row["response_class"],
                        }
                        for row in subset[:25]
                    ],
                }
            )
    return decisions


def find_duplicate_identifier_groups(rows):
    groups = defaultdict(list)
    for row in rows:
        if row["response_class"] in ("non_consent", "low_progress_no_pupil_identifiers", "no_pupil_identifiers"):
            continue
        key = (row["entered_forename_norm"], row["entered_school_norm"], row["birth_month_year"])
        if all(key):
            groups[key].append(row)
    duplicates = []
    for key, members in groups.items():
        if len(members) > 1:
            duplicates.append(
                {
                    "key": {
                        "entered_forename_norm": key[0],
                        "entered_school_norm": key[1],
                        "birth_month_year": key[2],
                    },
                    "count": len(members),
                    "responses": [
                        {
                            "response_id": row["response_id"],
                            "progress": row["progress"],
                            "finished": row["finished"],
                            "recorded_date_raw": row["recorded_date_raw"],
                            "entered_forename_raw": row["entered_forename_raw"],
                            "entered_school_raw": row["entered_school_raw"],
                        }
                        for row in members
                    ],
                }
            )
    duplicates.sort(key=lambda item: item["count"], reverse=True)
    return duplicates


def parse_recorded_date_key(value):
    text = str(value or "").strip()
    return text or "9999-99-99 99:99:99"


def canonical_choice_key(row):
    progress = parse_int(row.get("progress")) or 0
    return (-progress, parse_recorded_date_key(row.get("recorded_date_raw")), str(row.get("response_id", "")))


def display_sort_key(row):
    progress = parse_int(row.get("progress")) or 0
    return (-progress, parse_recorded_date_key(row.get("recorded_date_raw")), str(row.get("response_id", "")))


def nonempty(value):
    return str(value).strip() != ""


def build_duplicate_audit(rows, raw_rows):
    raw_by_response = {str(row.get("ResponseId", "")).strip(): row for row in raw_rows}
    headers = list(raw_rows[0].keys()) if raw_rows else []
    try:
        substantive_fields = headers[headers.index("Planning&monitoring_1") :]
    except ValueError:
        substantive_fields = headers[headers.index("DOB_2") + 1 :] if "DOB_2" in headers else []

    groups = defaultdict(list)
    for row in rows:
        if row["response_class"] in ("non_consent", "low_progress_no_pupil_identifiers", "no_pupil_identifiers"):
            continue
        key = (row["entered_forename_norm"], row["entered_school_norm"], row["birth_month_year"])
        if all(key):
            groups[key].append(row)

    audit = []
    for key, members in groups.items():
        if len(members) <= 1:
            continue
        canonical = sorted(members, key=canonical_choice_key)[0]
        canonical_raw = raw_by_response.get(canonical["response_id"], {})
        member_audits = []
        classifications = []
        for member in sorted(members, key=display_sort_key):
            member_raw = raw_by_response.get(member["response_id"], {})
            answer_fields_with_values = sum(1 for field in substantive_fields if nonempty(member_raw.get(field, "")))
            differences = []
            conflict_count = 0
            missing_from_member_count = 0
            member_extra_count = 0
            member_conflicts_with_canonical = False
            member_has_extra_answers = False
            for field in substantive_fields:
                member_value = str(member_raw.get(field, "")).strip()
                canonical_value = str(canonical_raw.get(field, "")).strip()
                if member_value == canonical_value:
                    continue
                if member_value and canonical_value:
                    member_conflicts_with_canonical = True
                    conflict_count += 1
                if member_value and not canonical_value:
                    member_has_extra_answers = True
                    member_extra_count += 1
                if canonical_value and not member_value:
                    missing_from_member_count += 1
                if member_value or canonical_value:
                    differences.append(
                        {
                            "field": field,
                            "canonical_value": canonical_value,
                            "member_value": member_value,
                        }
                    )
            if member["response_id"] == canonical["response_id"]:
                classification = "canonical"
            elif not differences:
                classification = "same_substantive_answers_as_canonical"
            elif not member_conflicts_with_canonical and not member_has_extra_answers:
                classification = "partial_subset_of_canonical"
            else:
                classification = "different_or_conflicting_answers"
            classifications.append(classification)
            member_audits.append(
                {
                    "response_id": member["response_id"],
                    "classification": classification,
                    "progress": member["progress"],
                    "finished": member["finished"],
                    "recorded_date_raw": member["recorded_date_raw"],
                    "entered_forename_raw": member["entered_forename_raw"],
                    "entered_school_raw": member["entered_school_raw"],
                    "answer_fields_with_values": answer_fields_with_values,
                    "difference_count_vs_canonical": len(differences),
                    "conflicting_answer_count_vs_canonical": conflict_count,
                    "missing_answer_count_vs_canonical": missing_from_member_count,
                    "extra_answer_count_vs_canonical": member_extra_count,
                    "difference_sample_vs_canonical": differences[:12],
                }
            )

        noncanonical_classes = [value for value in classifications if value != "canonical"]
        if all(value == "same_substantive_answers_as_canonical" for value in noncanonical_classes):
            group_classification = "all_same_substantive_answers"
        elif all(value in ("same_substantive_answers_as_canonical", "partial_subset_of_canonical") for value in noncanonical_classes):
            group_classification = "duplicates_are_same_or_partial_subsets"
        else:
            group_classification = "has_different_or_conflicting_answers"

        audit.append(
            {
                "key": {
                    "entered_forename_norm": key[0],
                    "entered_school_norm": key[1],
                    "birth_month_year": key[2],
                },
                "count": len(members),
                "group_classification": group_classification,
                "canonical_response_id": canonical["response_id"],
                "responses": member_audits,
            }
        )
    audit.sort(key=lambda item: (item["group_classification"], -item["count"], item["key"]["entered_forename_norm"]))
    return audit


def write_duplicate_audit_csv(path, audit):
    rows = []
    for group in audit:
        for response in group["responses"]:
            rows.append(
                {
                    "entered_forename_norm": group["key"]["entered_forename_norm"],
                    "entered_school_norm": group["key"]["entered_school_norm"],
                    "birth_month_year": group["key"]["birth_month_year"],
                    "group_count": group["count"],
                    "group_classification": group["group_classification"],
                    "canonical_response_id": group["canonical_response_id"],
                    "response_id": response["response_id"],
                    "response_classification": response["classification"],
                    "progress": response["progress"],
                    "finished": response["finished"],
                    "recorded_date_raw": response["recorded_date_raw"],
                    "entered_forename_raw": response["entered_forename_raw"],
                    "entered_school_raw": response["entered_school_raw"],
                    "answer_fields_with_values": response["answer_fields_with_values"],
                    "difference_count_vs_canonical": response["difference_count_vs_canonical"],
                    "conflicting_answer_count_vs_canonical": response["conflicting_answer_count_vs_canonical"],
                    "missing_answer_count_vs_canonical": response["missing_answer_count_vs_canonical"],
                    "extra_answer_count_vs_canonical": response["extra_answer_count_vs_canonical"],
                }
            )
    write_csv(
        path,
        rows,
        [
            "entered_forename_norm",
            "entered_school_norm",
            "birth_month_year",
            "group_count",
            "group_classification",
            "canonical_response_id",
            "response_id",
            "response_classification",
            "progress",
            "finished",
            "recorded_date_raw",
            "entered_forename_raw",
            "entered_school_raw",
            "answer_fields_with_values",
            "difference_count_vs_canonical",
            "conflicting_answer_count_vs_canonical",
            "missing_answer_count_vs_canonical",
            "extra_answer_count_vs_canonical",
        ],
    )


def build_duplicate_member_lookup(audit):
    lookup = {}
    for group in audit:
        key_text = "|".join(
            [
                group["key"]["entered_forename_norm"],
                group["key"]["entered_school_norm"],
                group["key"]["birth_month_year"],
            ]
        )
        for response in group["responses"]:
            is_canonical = response["response_id"] == group["canonical_response_id"]
            lookup[response["response_id"]] = {
                "dedupe_group_key": key_text,
                "dedupe_group_count": group["count"],
                "dedupe_group_classification": group["group_classification"],
                "canonical_response_id": group["canonical_response_id"],
                "is_canonical_response": "true" if is_canonical else "false",
                "dedupe_decision": "retain_canonical" if is_canonical else "drop_duplicate_attempt",
                "duplicate_response_classification": response["classification"],
                "conflicting_answer_count_vs_canonical": response["conflicting_answer_count_vs_canonical"],
                "missing_answer_count_vs_canonical": response["missing_answer_count_vs_canonical"],
                "extra_answer_count_vs_canonical": response["extra_answer_count_vs_canonical"],
            }
    return lookup


def write_deduped_outputs(out_dir, rows, raw_rows, audit, base_fieldnames):
    member_lookup = build_duplicate_member_lookup(audit)
    dedupe_fields = [
        "dedupe_group_key",
        "dedupe_group_count",
        "dedupe_group_classification",
        "canonical_response_id",
        "is_canonical_response",
        "dedupe_decision",
        "duplicate_response_classification",
        "conflicting_answer_count_vs_canonical",
        "missing_answer_count_vs_canonical",
        "extra_answer_count_vs_canonical",
    ]
    raw_by_row_index = {idx: raw_row for idx, raw_row in enumerate(raw_rows, start=1)}
    raw_fieldnames = [field for field in (list(raw_rows[0].keys()) if raw_rows else []) if field]
    processed_fieldnames = base_fieldnames + dedupe_fields
    used_fieldnames = set(processed_fieldnames)
    raw_field_map = {}
    for field in raw_fieldnames:
        output_field = field
        if output_field in used_fieldnames:
            output_field = f"qualtrics_{field}"
        suffix = 2
        unique_output_field = output_field
        while unique_output_field in used_fieldnames:
            unique_output_field = f"{output_field}_{suffix}"
            suffix += 1
        used_fieldnames.add(unique_output_field)
        raw_field_map[field] = unique_output_field

    rows_with_decisions = []
    full_canonical_rows = []
    for row in rows:
        decision = member_lookup.get(row["response_id"])
        enriched = dict(row)
        if decision:
            enriched.update(decision)
        else:
            enriched.update(
                {
                    "dedupe_group_key": "",
                    "dedupe_group_count": "",
                    "dedupe_group_classification": "",
                    "canonical_response_id": row["response_id"],
                    "is_canonical_response": "true",
                    "dedupe_decision": "retain_unique",
                    "duplicate_response_classification": "",
                    "conflicting_answer_count_vs_canonical": "",
                    "missing_answer_count_vs_canonical": "",
                    "extra_answer_count_vs_canonical": "",
                }
            )
        rows_with_decisions.append(enriched)
        if enriched["is_canonical_response"] == "true":
            full_row = {field: enriched.get(field, "") for field in processed_fieldnames}
            raw_row = raw_by_row_index.get(int(enriched["survey_row_index"]), {})
            for raw_field, output_field in raw_field_map.items():
                full_row[output_field] = raw_row.get(raw_field, "")
            full_canonical_rows.append(full_row)

    write_csv(out_dir / "survey_response_dedupe_decisions.csv", rows_with_decisions, processed_fieldnames)
    write_csv(out_dir / DEDUPED_FULL_SURVEY_FILENAME, full_canonical_rows, processed_fieldnames + list(raw_field_map.values()))
    legacy_path = out_dir / LEGACY_DEDUPED_SURVEY_FILENAME
    if legacy_path.exists():
        legacy_path.unlink()
    return {
        "canonical_response_rows": len(full_canonical_rows),
        "duplicate_attempt_rows_removed": len(rows) - len(full_canonical_rows),
        "duplicate_identity_groups": len(audit),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--zip", default=str(DEFAULT_ZIP))
    parser.add_argument("--out", default=str(DEFAULT_OUTPUT))
    args = parser.parse_args()

    out_dir = Path(args.out)
    source_name, raw_rows = read_survey_rows(args.zip)
    rows = normalize_rows(raw_rows)
    duplicate_audit = build_duplicate_audit(rows, raw_rows)

    fieldnames = [
        "survey_row_index",
        "response_id",
        "start_date_raw",
        "end_date_raw",
        "recorded_date_raw",
        "status_raw",
        "progress",
        "duration_seconds",
        "finished",
        "consent_raw",
        "duplicate_respondent_raw",
        "entered_forename_raw",
        "entered_forename_norm",
        "entered_school_raw",
        "entered_school_norm",
        "birth_year_raw",
        "birth_month_raw",
        "birth_year",
        "birth_month",
        "birth_year_status",
        "birth_month_status",
        "birth_month_year",
        "response_class",
        "manual_identifier_decision",
    ]
    write_csv(out_dir / "normalized_survey_responses.csv", rows, fieldnames)

    dropped_duplicate_rows = [response for group in duplicate_audit for response in group["responses"] if response["classification"] != "canonical"]
    profile = {
        "source_csv": source_name,
        "response_rows": len(rows),
        "dedupe_rule": "Within repeated pupil-entered identity groups, retain highest Progress; if tied, retain oldest RecordedDate.",
        "class_counts": dict(Counter(row["response_class"] for row in rows)),
        "finished_counts": dict(Counter(row["finished"] for row in rows)),
        "consent_counts": dict(Counter(row["consent_raw"] for row in rows)),
        "progress_counts": dict(Counter(str(row["progress"]) for row in rows)),
        "birth_year_status_counts": dict(Counter(row["birth_year_status"] for row in rows)),
        "birth_month_status_counts": dict(Counter(row["birth_month_status"] for row in rows)),
        "top_entered_school_raw": top_values(rows, "entered_school_raw", 100),
        "top_entered_school_norm": top_values(rows, "entered_school_norm", 100),
        "duplicate_identifier_groups": find_duplicate_identifier_groups(rows),
        "duplicate_pupil_entered_identity_audit_counts": dict(Counter(item["group_classification"] for item in duplicate_audit)),
        "duplicate_response_id_count": sum(1 for _, count in Counter(row["response_id"] for row in rows).items() if count > 1),
        "duplicate_pupil_entered_identity_summary": {
            "groups": len(duplicate_audit),
            "responses_in_groups": sum(group["count"] for group in duplicate_audit),
            "dropped_duplicate_attempt_rows": sum(group["count"] - 1 for group in duplicate_audit),
            "groups_with_multiple_100_percent_responses": sum(1 for group in duplicate_audit if sum(1 for response in group["responses"] if int(response["progress"]) == 100) > 1),
            "dropped_100_percent_rows": sum(1 for response in dropped_duplicate_rows if int(response["progress"]) == 100),
            "dropped_rows_with_conflicting_answers": sum(1 for response in dropped_duplicate_rows if int(response["conflicting_answer_count_vs_canonical"]) > 0),
            "dropped_rows_with_no_conflicting_answers": sum(1 for response in dropped_duplicate_rows if int(response["conflicting_answer_count_vs_canonical"]) == 0),
        },
    }
    (out_dir / "survey_profile.json").write_text(json.dumps(profile, indent=2), encoding="utf-8")
    (out_dir / "survey_duplicate_identity_audit.json").write_text(json.dumps(duplicate_audit, indent=2), encoding="utf-8")
    write_duplicate_audit_csv(out_dir / "survey_duplicate_identity_audit.csv", duplicate_audit)
    dedupe_summary = write_deduped_outputs(out_dir, rows, raw_rows, duplicate_audit, fieldnames)

    decisions = build_decisions(rows)
    (out_dir / "survey_decisions_needed.json").write_text(json.dumps(decisions, indent=2), encoding="utf-8")

    print(
        json.dumps(
            {
                "source_csv": source_name,
                "response_rows": len(rows),
                "class_counts": profile["class_counts"],
                "birth_year_status_counts": profile["birth_year_status_counts"],
                "birth_month_status_counts": profile["birth_month_status_counts"],
                "duplicate_identifier_groups": len(profile["duplicate_identifier_groups"]),
                "duplicate_response_id_count": profile["duplicate_response_id_count"],
                "duplicate_pupil_entered_identity_audit_counts": profile["duplicate_pupil_entered_identity_audit_counts"],
                "dedupe_summary": dedupe_summary,
                "decision_groups": len(decisions),
                "outputs": [
                    str(out_dir / "normalized_survey_responses.csv"),
                    str(out_dir / DEDUPED_FULL_SURVEY_FILENAME),
                    str(out_dir / "survey_response_dedupe_decisions.csv"),
                    str(out_dir / "survey_profile.json"),
                    str(out_dir / "survey_duplicate_identity_audit.json"),
                    str(out_dir / "survey_duplicate_identity_audit.csv"),
                    str(out_dir / "survey_decisions_needed.json"),
                ],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
