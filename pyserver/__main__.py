from __future__ import annotations

import uvicorn

from .settings import get_settings


def main() -> None:
    settings = get_settings()
    uvicorn.run("pyserver.app:app", host="0.0.0.0", port=settings.port, reload=False, factory=False)


if __name__ == "__main__":
    main()
