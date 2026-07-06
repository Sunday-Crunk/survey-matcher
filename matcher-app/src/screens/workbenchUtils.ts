export function includesText(values: Array<unknown>, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return values
    .filter((value) => value !== null && value !== undefined)
    .join(" ")
    .toLowerCase()
    .includes(normalized);
}

export function asPercent(value: number) {
  return `${Number(value || 0).toFixed(1)}%`;
}

export function compactDate(value: string | null | undefined) {
  if (!value) return "";
  return value.replace("T", " ").slice(0, 19);
}
