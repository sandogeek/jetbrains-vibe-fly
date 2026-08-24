export type StateDotState = "done" | "ongoing" | "error"

const MATRIX_CELLS: readonly (readonly [number, number])[] = [
    [0, 0], [4, 0], [8, 0], [8, 4], [8, 8], [4, 8], [0, 8], [0, 4],
]

export function StateDot({
    state,
    size = 10,
}: {
    state: StateDotState
    size?: number
}) {
    if (state === "ongoing") {
        return (
            <svg
                className="state-dot-matrix"
                data-state="ongoing"
                width={size}
                height={size}
                viewBox="0 0 10 10"
                shapeRendering="crispEdges"
                aria-hidden="true"
            >
                {MATRIX_CELLS.map(([x, y], index) => (
                    <rect
                        key={`${x}-${y}`}
                        className="state-dot-cell"
                        x={x}
                        y={y}
                        width="2"
                        height="2"
                        style={{animationDelay: `${(index - MATRIX_CELLS.length) * 125}ms`}}
                    />
                ))}
            </svg>
        )
    }
    return (
        <span
            className="state-dot"
            data-state={state}
            style={{width: size, height: size}}
            aria-hidden="true"
        />
    )
}
