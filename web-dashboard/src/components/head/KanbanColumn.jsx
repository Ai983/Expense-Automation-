import KanbanCard from './KanbanCard';

export default function KanbanColumn({ title, items, stream, onCardClick, colorClass = 'bg-gray-100' }) {
  return (
    <div className="flex-shrink-0 w-56">
      <div className={`rounded-t-lg px-3 py-2 flex items-center justify-between ${colorClass}`}>
        <span className="font-semibold text-sm text-gray-700 truncate">{title}</span>
        <span className="ml-2 bg-white text-gray-600 text-xs font-bold rounded-full px-2 py-0.5 min-w-[22px] text-center">
          {items.length}
        </span>
      </div>
      <div className="bg-gray-50 border border-gray-200 border-t-0 rounded-b-lg p-2 min-h-[80px] max-h-[520px] overflow-y-auto">
        {items.length === 0 ? (
          <p className="text-gray-400 text-xs text-center py-4">Empty</p>
        ) : (
          items.map((item) => (
            <KanbanCard key={item.id} item={item} stream={stream} onClick={onCardClick} />
          ))
        )}
      </div>
    </div>
  );
}
