/** Fills `{name}` placeholders in a dictionary string. Safe on server and client. */
export function t(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? `{${k}}`));
}
