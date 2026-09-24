/**
 * Quote one executable argument in a freedesktop Desktop Entry Exec value.
 *
 * Desktop entries split unquoted whitespace before launching the command. Escape
 * the metacharacters accepted by the Exec grammar, then quote the whole argument.
 */
export function quoteDesktopExecArg(value: string): string {
  const escaped = value.replace(/([\\`"$])/g, '\\$1').replace(/%/g, '%%')
  return `"${escaped}"`
}