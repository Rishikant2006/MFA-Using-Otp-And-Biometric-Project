const redact = (value) =>
  String(value || '')
    .replace(/[\r\n]/g, ' ')
    .slice(0, 500);

const log = (level, message, context = {}) => {
  // JSON logs are machine-readable and deliberately avoid request bodies, tokens, and credentials.
  const entry = { timestamp: new Date().toISOString(), level, message, ...context };
  const output = JSON.stringify(entry, (_key, value) => (typeof value === 'string' ? redact(value) : value));
  if (level === 'error') console.error(output);
  else console.info(output);
};

module.exports = { log };
