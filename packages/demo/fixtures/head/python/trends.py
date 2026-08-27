def trend(previous: float, current: float) -> str:
    if current > previous:
        return "up"
    if current < previous:
        return "down"
    return "stable"
