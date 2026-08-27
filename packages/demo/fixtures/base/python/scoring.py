def architecture_score(symbols: int, edges: int) -> float:
    if symbols <= 0:
        return 0.0
    return min(1.0, edges / symbols)
