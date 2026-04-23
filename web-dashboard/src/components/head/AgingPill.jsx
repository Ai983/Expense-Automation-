export default function AgingPill({ submittedAt, stageAt }) {
  const base = stageAt || submittedAt;
  if (!base) return null;
  const hours = (Date.now() - new Date(base).getTime()) / 3600000;

  let bg, text, label;
  if (hours < 12) {
    bg = 'bg-green-100'; text = 'text-green-700'; label = `${Math.round(hours)}h`;
  } else if (hours < 24) {
    bg = 'bg-yellow-100'; text = 'text-yellow-700'; label = `${Math.round(hours)}h`;
  } else if (hours < 48) {
    bg = 'bg-orange-100'; text = 'text-orange-700'; label = `${Math.round(hours / 24)}d ${Math.round(hours % 24)}h`;
  } else {
    const days = Math.floor(hours / 24);
    const rem = Math.round(hours % 24);
    bg = 'bg-red-100'; text = 'text-red-700'; label = `${days}d ${rem}h`;
  }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${bg} ${text}`}>
      {label}
    </span>
  );
}

export function getAgingLevel(submittedAt, stageAt) {
  const base = stageAt || submittedAt;
  if (!base) return 'green';
  const hours = (Date.now() - new Date(base).getTime()) / 3600000;
  if (hours < 12) return 'green';
  if (hours < 24) return 'yellow';
  if (hours < 48) return 'amber';
  return 'red';
}
