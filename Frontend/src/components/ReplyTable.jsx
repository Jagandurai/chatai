export default function ReplyTable({ columns, rows }) {
  const isMultiRow = rows.length > 1;

  return (
    <div className="w-full overflow-x-auto bg-zinc-950">
      <table className="min-w-full text-left text-[11px] sm:text-xs border-collapse">
        
        <tbody className="text-zinc-100">
          {rows.map((row, idx) => {
            const showBorder = isMultiRow && idx !== 0;

            return (
              <tr
                key={idx}
                className={`text-green-700 bg-green-100 ${
                  showBorder ? "border-t border-green-300" : "border-0"
                }`}
              >
                
                {/* Numbering */}
                {isMultiRow && (
                  <td className="px-2 py-2 sm:px-3 text-green-700 w-6 sm:w-8 border-0">
                    {idx + 1}
                  </td>
                )}

                {/* Data */}
                {columns.map((c) => (
                <td
                  key={c}
                  className={`
                    px-2 py-2 
                    sm:px-3 
                    align-top 
                    whitespace-pre-wrap 
                    break-words
                    max-w-[140px] sm:max-w-none
                    ${showBorder ? "" : "border-0"}
                  `}
                >
                  {String(row?.[c] ?? "")}
                </td>
                ))}

              </tr>
            );
          })}
        </tbody>

      </table>
    </div>
  );
}