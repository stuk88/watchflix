export function rewriteParams(sql) {
  return sql.replace(/@(\w+)/g, '$$$1');
}

export function rewriteBindings(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return params;
  const result = {};
  for (const [key, value] of Object.entries(params)) {
    result[`$${key}`] = value;
  }
  return result;
}
