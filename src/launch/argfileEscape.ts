/**
 * Java @argfile escaping: wrap in quotes if needed; escape " and \.
 * @see https://docs.oracle.com/en/java/javase/17/docs/specs/man/java.html#java-command-line-argument-files
 */
export function escapeJavaArgfileLine(arg: string): string {
  if (arg.length === 0) return '""';
  if (!/[\s"\\]/.test(arg)) return arg;
  return `"${arg.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
