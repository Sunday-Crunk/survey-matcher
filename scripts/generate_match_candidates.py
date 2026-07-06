import argparse
import csv
import hashlib
import json
import math
import re
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "outputs"
DEDUPED_FULL_SURVEY_FILENAME = "deduped_survey_full_responses.csv"
GENERIC_SCHOOL_WORDS = {
    "the",
    "a",
    "school",
    "high",
    "secondary",
    "academy",
    "college",
    "technology",
    "for",
    "girls",
    "boys",
    "and",
    "sixth",
    "form",
    "centre",
    "campus",
    "learning",
    "community",
    "church",
    "england",
    "catholic",
    "cofe",
    "e",
    "act",
}

NAME_ALIAS_GROUPS = [
    {"sam", "sammy", "sammie", "samuel", "samantha"},
    {"tom", "tommy", "thomas"},
    {"will", "wills", "william", "billy"},
    {"charlie", "charles"},
    {"libby", "liz", "lizzie", "beth", "betsy", "elizabeth"},
    {"ollie", "oliver"},
    {"archie", "archibald"},
    {"alfie", "alfred"},
    {"freddie", "fred", "frederick"},
    {"harry", "henry", "harrison"},
    {"josh", "joshua"},
    {"ben", "benjamin"},
    {"alex", "alexander", "alexandra", "alexia"},
    {"maddie", "maddy", "madison", "madeleine"},
    {"evie", "eve", "evelyn"},
    {"izzy", "isobel", "isabel", "isabella"},
    {"lilly", "lily", "lillie"},
    {"katie", "kate", "katherine", "catherine"},
    {"joe", "joey", "joseph"},
    {"dan", "danny", "daniel"},
    {"mike", "mikey", "michael"},
]


def norm_text(value):
    if value is None:
        return ""
    text = str(value).strip().lower()
    text = text.replace("&", " and ")
    text = re.sub(r"[_\n\r\t]+", " ", text)
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def norm_name(value):
    return re.sub(r"[^a-z]", "", norm_text(value))


def school_key(value):
    text = norm_text(value)
    tokens = [token for token in text.split() if token not in GENERIC_SCHOOL_WORDS]
    return " ".join(tokens)


def compact(value):
    return re.sub(r"[^a-z0-9]", "", norm_text(value))


def school_acronym(value):
    tokens = [token for token in norm_text(value).split() if token and token not in {"the", "a", "of", "and", "for"}]
    if len(tokens) < 2:
        return ""
    return "".join(token[0] for token in tokens)


def token_set(value):
    return set(token for token in school_key(value).split() if token)


def ratio(a, b):
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    return SequenceMatcher(None, a, b).ratio()


def school_similarity(a, b):
    a_key = school_key(a)
    b_key = school_key(b)
    if not a_key or not b_key:
        return 0.0
    if a_key == b_key:
        return 1.0
    a_compact = compact(a_key)
    b_compact = compact(b_key)
    if a_compact and b_compact and (a_compact == b_compact or a_compact in b_compact or b_compact in a_compact):
        return 0.96
    a_acronym = school_acronym(a)
    b_acronym = school_acronym(b)
    if len(a_acronym) >= 2 and a_acronym == compact(b_key):
        return 0.94
    if len(b_acronym) >= 2 and b_acronym == compact(a_key):
        return 0.94
    if len(a_acronym) >= 2 and len(b_acronym) >= 2 and a_acronym == b_acronym:
        return 0.92
    if a_key in b_key or b_key in a_key:
        return 0.96
    a_tokens = set(a_key.split())
    b_tokens = set(b_key.split())
    overlap = len(a_tokens & b_tokens)
    union = len(a_tokens | b_tokens)
    jaccard = overlap / union if union else 0.0
    containment = max(overlap / len(a_tokens), overlap / len(b_tokens)) if a_tokens and b_tokens else 0.0
    seq = ratio(a_key, b_key)
    return max(seq, jaccard, containment * 0.94)


def alias_score(survey_name_norm, roster_forename_norm):
    if not survey_name_norm or not roster_forename_norm:
        return 0.0
    for group in NAME_ALIAS_GROUPS:
        if survey_name_norm in group and roster_forename_norm in group:
            return 0.92
    return 0.0


def name_score_and_reason(survey_raw, roster_forename, roster_surname):
    survey_norm = norm_name(survey_raw)
    roster_forename_norm = norm_name(roster_forename)
    roster_surname_norm = norm_name(roster_surname)
    full_norm = f"{roster_forename_norm}{roster_surname_norm}"
    reverse_full_norm = f"{roster_surname_norm}{roster_forename_norm}"
    survey_tokens = [norm_name(token) for token in norm_text(survey_raw).split()]
    survey_tokens = [token for token in survey_tokens if token]

    if not survey_norm or not roster_forename_norm:
        return 0.0, "name_missing"
    if survey_norm == roster_forename_norm:
        return 1.0, "forename_exact"
    if survey_norm == full_norm:
        return 1.0, "full_name_exact"
    if survey_norm == reverse_full_norm:
        return 0.98, "full_name_reversed_exact"
    if roster_forename_norm in survey_tokens and (not roster_surname_norm or roster_surname_norm in survey_tokens):
        return 0.98, "name_tokens_include_roster_name"
    if roster_forename_norm in survey_tokens:
        return 0.94, "name_tokens_include_forename"
    alias = alias_score(survey_norm, roster_forename_norm)
    if alias:
        return alias, "known_name_alias"
    if survey_norm.startswith(roster_forename_norm) or roster_forename_norm.startswith(survey_norm):
        shorter = min(len(survey_norm), len(roster_forename_norm))
        if shorter >= 4:
            return 0.88, "forename_prefix"
    fuzzy = ratio(survey_norm, roster_forename_norm)
    if fuzzy >= 0.92:
        return fuzzy, "forename_fuzzy_strong"
    if fuzzy >= 0.82:
        return fuzzy, "forename_fuzzy_medium"
    return fuzzy, "forename_weak"


def best_name_score_and_reason(response, child):
    primary_score, primary_reason = name_score_and_reason(
        response.get("entered_forename_raw", ""),
        child.get("forename_raw", ""),
        child.get("surname_raw", ""),
    )
    combined_raw = f"{response.get('entered_forename_raw', '')} {response.get('entered_school_raw', '')}".strip()
    combined_score, combined_reason = name_score_and_reason(
        combined_raw,
        child.get("forename_raw", ""),
        child.get("surname_raw", ""),
    )
    if combined_score > primary_score and combined_reason in {
        "full_name_exact",
        "full_name_reversed_exact",
        "name_tokens_include_roster_name",
    }:
        return combined_score, f"{combined_reason}_from_response_name_and_school_fields"
    return primary_score, primary_reason


def stable_id(prefix, *parts):
    digest = hashlib.sha1("|".join(str(part) for part in parts).encode("utf-8")).hexdigest()[:12]
    return f"{prefix}_{digest}"


def read_csv(path):
    with Path(path).open("r", newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def write_csv(path, rows, fieldnames):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def int_or_blank(value):
    try:
        if str(value).strip() == "":
            return ""
        return int(float(str(value).strip()))
    except ValueError:
        return ""


def birth_month_year_from_roster(row):
    year = int_or_blank(row.get("birth_year"))
    month = int_or_blank(row.get("birth_month"))
    if isinstance(year, int) and isinstance(month, int):
        return f"{year}-{month:02d}"
    return ""


def prepare_roster(rows):
    prepared = []
    for row in rows:
        roster_school_raw = row.get("school_raw") or row.get("school_from_filename") or ""
        child_id = row.get("roster_child_id") or stable_id(
            "child",
            row.get("roster_file", ""),
            row.get("source_row", ""),
            row.get("forename_raw", ""),
            row.get("surname_raw", ""),
            row.get("dob_iso", ""),
        )
        item = dict(row)
        item["roster_child_id"] = child_id
        item["roster_school_raw"] = roster_school_raw
        item["roster_school_key"] = school_key(roster_school_raw)
        item["birth_month_year"] = birth_month_year_from_roster(row)
        prepared.append(item)
    return prepared


def should_attempt_match(response):
    if response.get("response_class") in {"non_consent", "low_progress_no_pupil_identifiers", "no_pupil_identifiers"}:
        return False
    return bool(response.get("entered_forename_norm") or response.get("entered_school_norm") or response.get("birth_month_year"))


def dob_status(response, child):
    response_bmy = response.get("birth_month_year", "")
    child_bmy = child.get("birth_month_year", "")
    if response_bmy and child_bmy:
        return "exact" if response_bmy == child_bmy else "mismatch"
    if not response_bmy:
        return "survey_missing"
    if not child_bmy:
        return "roster_missing"
    return "missing"


def score_candidate(response, child, school_score, name_score):
    dob = dob_status(response, child)
    score = 0.0
    score += min(school_score, 1.0) * 35
    score += min(name_score, 1.0) * 30
    if dob == "exact":
        score += 35
    elif dob in {"survey_missing", "roster_missing", "missing"}:
        score += 8
    else:
        score -= 22
    return max(0.0, round(score, 2))


def candidate_gate(response, child, school_score, name_score):
    dob = dob_status(response, child)
    gates = []
    if school_score >= 0.88 and dob == "exact":
        gates.append("strong_school_and_dob")
    if school_score >= 0.88 and name_score >= 0.82:
        gates.append("strong_school_and_name")
    if dob == "exact" and name_score >= 0.92 and school_score >= 0.60:
        gates.append("dob_and_very_strong_name_with_plausible_school")
    if dob == "exact" and name_score >= 0.98:
        gates.append("dob_and_exact_or_full_name")
    if school_score >= 0.80 and dob == "exact" and name_score >= 0.74:
        gates.append("plausible_school_dob_and_name")
    if response.get("manual_identifier_decision") and school_score >= 0.88 and name_score >= 0.92:
        gates.append("manual_identifier_decision_school_and_name")
    return gates


def confidence_label(score, top_gap, school_score, name_score, dob, gate_names):
    if (
        score >= 88
        and top_gap >= 8
        and school_score >= 0.88
        and name_score >= 0.82
        and dob != "mismatch"
        and gate_names
    ):
        return "high_preselect"
    if score >= 72:
        return "medium_review"
    return "low_review"


def reason_codes(school_score, name_reason, dob, uniqueness_bonus, gates):
    reasons = []
    if school_score >= 0.98:
        reasons.append("school_exact_or_alias")
    elif school_score >= 0.88:
        reasons.append("school_strong_fuzzy")
    elif school_score >= 0.65:
        reasons.append("school_weak_fuzzy")
    reasons.append(name_reason)
    reasons.append(f"dob_{dob}")
    if uniqueness_bonus:
        reasons.append("unique_child_in_school_month_year")
    reasons.extend(gates)
    return [reason for reason in reasons if reason]


def generate_candidates(roster_rows, survey_rows, max_candidates=10):
    roster = prepare_roster(roster_rows)
    school_bmy_counts = Counter((child["roster_school_key"], child["birth_month_year"]) for child in roster if child["birth_month_year"])
    unique_roster_schools = sorted(set(child["roster_school_raw"] for child in roster))
    candidate_rows = []
    response_summary = []

    for response in survey_rows:
        if not should_attempt_match(response):
            response_summary.append(
                {
                    "response_id": response.get("response_id", ""),
                    "candidate_count": 0,
                    "top_score": "",
                    "top_gap": "",
                    "top_confidence": "not_matchable",
                    "preselected_roster_child_id": "",
                    "entered_forename_raw": response.get("entered_forename_raw", ""),
                    "entered_school_raw": response.get("entered_school_raw", ""),
                    "birth_month_year": response.get("birth_month_year", ""),
                    "response_class": response.get("response_class", ""),
                }
            )
            continue

        school_score_cache = {
            school: school_similarity(response.get("entered_school_raw", ""), school)
            for school in unique_roster_schools
        }
        candidates = []
        for child in roster:
            school_score = school_score_cache.get(child["roster_school_raw"], 0.0)
            dob = dob_status(response, child)
            if school_score < 0.60 and dob != "exact":
                continue
            name_score, name_reason = best_name_score_and_reason(response, child)
            gates = candidate_gate(response, child, school_score, name_score)
            if not gates:
                continue
            unique_school_bmy = dob == "exact" and school_bmy_counts[(child["roster_school_key"], child["birth_month_year"])] == 1
            score = score_candidate(response, child, school_score, name_score)
            if unique_school_bmy:
                score = min(100.0, score + 5)
            candidates.append(
                {
                    "response": response,
                    "child": child,
                    "score": score,
                    "school_score": round(school_score, 3),
                    "name_score": round(name_score, 3),
                    "name_reason": name_reason,
                    "dob_status": dob,
                    "unique_school_bmy": unique_school_bmy,
                    "gates": gates,
                }
            )

        candidates.sort(key=lambda item: (-item["score"], -item["school_score"], -item["name_score"], item["child"]["roster_child_id"]))
        top_score = candidates[0]["score"] if candidates else ""
        second_score = candidates[1]["score"] if len(candidates) > 1 else -math.inf
        top_gap = round(candidates[0]["score"] - second_score, 2) if len(candidates) > 1 else 999
        top_confidence = "no_candidate"
        preselected_child = ""
        if candidates:
            top = candidates[0]
            top_confidence = confidence_label(
                top["score"],
                top_gap,
                top["school_score"],
                top["name_score"],
                top["dob_status"],
                top["gates"],
            )
            if top_confidence == "high_preselect":
                preselected_child = top["child"]["roster_child_id"]

        response_summary.append(
            {
                "response_id": response.get("response_id", ""),
                "candidate_count": len(candidates),
                "top_score": top_score,
                "top_gap": top_gap if candidates else "",
                "top_confidence": top_confidence,
                "preselected_roster_child_id": preselected_child,
                "entered_forename_raw": response.get("entered_forename_raw", ""),
                "entered_school_raw": response.get("entered_school_raw", ""),
                "birth_month_year": response.get("birth_month_year", ""),
                "response_class": response.get("response_class", ""),
            }
        )

        for rank, candidate in enumerate(candidates[:max_candidates], start=1):
            child = candidate["child"]
            response_row = candidate["response"]
            reasons = reason_codes(
                candidate["school_score"],
                candidate["name_reason"],
                candidate["dob_status"],
                candidate["unique_school_bmy"],
                candidate["gates"],
            )
            candidate_rows.append(
                {
                    "response_id": response_row.get("response_id", ""),
                    "candidate_rank": rank,
                    "confidence": confidence_label(
                        candidate["score"],
                        top_gap,
                        candidate["school_score"],
                        candidate["name_score"],
                        candidate["dob_status"],
                        candidate["gates"],
                    ),
                    "preselected": "true" if rank == 1 and preselected_child == child["roster_child_id"] else "false",
                    "score": candidate["score"],
                    "top_gap": top_gap,
                    "school_score": candidate["school_score"],
                    "name_score": candidate["name_score"],
                    "dob_status": candidate["dob_status"],
                    "reason_codes": ";".join(reasons),
                    "entered_forename_raw": response_row.get("entered_forename_raw", ""),
                    "entered_school_raw": response_row.get("entered_school_raw", ""),
                    "survey_birth_month_year": response_row.get("birth_month_year", ""),
                    "response_class": response_row.get("response_class", ""),
                    "progress": response_row.get("progress", ""),
                    "roster_child_id": child["roster_child_id"],
                    "roster_forename": child.get("forename_raw", ""),
                    "roster_surname": child.get("surname_raw", ""),
                    "roster_school": child.get("roster_school_raw", ""),
                    "roster_birth_month_year": child.get("birth_month_year", ""),
                    "roster_dob_iso": child.get("dob_iso", ""),
                    "roster_file": child.get("roster_file", ""),
                    "roster_source_row": child.get("source_row", ""),
                }
            )

    return candidate_rows, response_summary


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--max-candidates", type=int, default=10)
    args = parser.parse_args()

    out_dir = Path(args.out)
    roster_rows = read_csv(out_dir / "normalized_roster.csv")
    survey_rows = read_csv(out_dir / DEDUPED_FULL_SURVEY_FILENAME)
    candidates, response_summary = generate_candidates(roster_rows, survey_rows, args.max_candidates)

    candidate_fields = [
        "response_id",
        "candidate_rank",
        "confidence",
        "preselected",
        "score",
        "top_gap",
        "school_score",
        "name_score",
        "dob_status",
        "reason_codes",
        "entered_forename_raw",
        "entered_school_raw",
        "survey_birth_month_year",
        "response_class",
        "progress",
        "roster_child_id",
        "roster_forename",
        "roster_surname",
        "roster_school",
        "roster_birth_month_year",
        "roster_dob_iso",
        "roster_file",
        "roster_source_row",
    ]
    summary_fields = [
        "response_id",
        "candidate_count",
        "top_score",
        "top_gap",
        "top_confidence",
        "preselected_roster_child_id",
        "entered_forename_raw",
        "entered_school_raw",
        "birth_month_year",
        "response_class",
    ]
    write_csv(out_dir / "match_candidates.csv", candidates, candidate_fields)
    write_csv(out_dir / "match_candidate_response_summary.csv", response_summary, summary_fields)

    matchable = [row for row in response_summary if row["top_confidence"] != "not_matchable"]
    profile = {
        "survey_rows": len(survey_rows),
        "matchable_response_rows": len(matchable),
        "not_matchable_response_rows": len(survey_rows) - len(matchable),
        "candidate_rows": len(candidates),
        "response_candidate_count_distribution": dict(Counter(str(row["candidate_count"]) for row in response_summary)),
        "top_confidence_counts": dict(Counter(row["top_confidence"] for row in response_summary)),
        "preselected_response_count": sum(1 for row in response_summary if row["preselected_roster_child_id"]),
        "no_candidate_response_count": sum(1 for row in response_summary if row["top_confidence"] == "no_candidate"),
    }
    (out_dir / "match_candidate_profile.json").write_text(json.dumps(profile, indent=2), encoding="utf-8")
    print(json.dumps({
        **profile,
        "outputs": [
            str(out_dir / "match_candidates.csv"),
            str(out_dir / "match_candidate_response_summary.csv"),
            str(out_dir / "match_candidate_profile.json"),
        ],
    }, indent=2))


if __name__ == "__main__":
    main()
