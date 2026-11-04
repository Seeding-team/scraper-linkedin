"""All-platform module — unified API layer backed by Supabase."""

def __getattr__(name: str):
    if name == "all_platform_router":
        from app.modules.all_platform.router import all_platform_router
        return all_platform_router
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

__all__ = ["all_platform_router"]
