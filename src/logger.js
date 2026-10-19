const format = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'long' });
export const localTime = date => format.format(date);
// Somente campos controlados: nunca serializar respostas, URLs, exceções ou cabeçalhos.
const allowed = ['attempt', 'durationMs', 'httpStatus', 'result', 'processed', 'nextAttempt', 'reason'];
export function createLogger(write = line => console.log(line)) {
  return (event, fields = {}) => {
    const safe = Object.fromEntries(allowed.filter(k => fields[k] !== undefined).map(k => [k, fields[k]]));
    write(JSON.stringify({ time: localTime(new Date()), timezone: 'America/Sao_Paulo', event, ...safe }));
  };
}
