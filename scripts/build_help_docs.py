from __future__ import annotations

import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

import markdown
import yaml

ROOT = Path(__file__).resolve().parents[1]
DOCS_DIR = ROOT / "docs" / "help"
OUT_DIR = ROOT / "frontend" / "help"
RENDERED_DIR = OUT_DIR / "rendered"
ASSETS_SRC = DOCS_DIR / "assets"
ASSETS_DST = OUT_DIR / "assets"
STATE_FILE = OUT_DIR / ".build-state.json"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def write_text_if_changed(path: Path, content: str) -> bool:
    if path.exists():
        existing = path.read_text(encoding="utf-8")
        if existing == content:
            return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return True


def copy_file_if_changed(src: Path, dst: Path) -> bool:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists() and sha256_file(src) == sha256_file(dst):
        return False
    shutil.copy2(src, dst)
    return True


def load_state() -> dict:
    if not STATE_FILE.exists():
        return {"markdown": {}, "assets": {}}
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {"markdown": {}, "assets": {}}


def save_state(state: dict) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")


def parse_markdown_file(path: Path) -> tuple[dict, str]:
    raw = path.read_text(encoding="utf-8")
    if raw.startswith("---"):
        parts = raw.split("---", 2)
        if len(parts) == 3:
            _, fm, body = parts
            meta = yaml.safe_load(fm) or {}
            return meta, body.strip()
    return {}, raw.strip()


def rewrite_asset_paths(html: str) -> str:
    return html.replace('src="assets/', 'src="/help/assets/')


def render_markdown(md_file: Path) -> tuple[dict, str]:
    meta, body = parse_markdown_file(md_file)

    slug = meta.get("slug") or md_file.stem
    section = meta.get("section", "General")
    title = meta.get("title", slug.replace("-", " ").title())
    order = int(meta.get("order", 999))

    html = markdown.markdown(
        body,
        extensions=["extra", "tables", "fenced_code", "toc"],
    )
    html = rewrite_asset_paths(html)

    manifest_entry = {
        "slug": slug,
        "title": title,
        "section": section,
        "order": order,
        "htmlPath": f"/help/rendered/{slug}.html",
    }
    return manifest_entry, html


def relative_posix(path: Path, base: Path) -> str:
    return path.relative_to(base).as_posix()


def collect_source_markdown() -> list[Path]:
    return sorted(p for p in DOCS_DIR.glob("*.md") if p.is_file())


def collect_source_assets() -> list[Path]:
    if not ASSETS_SRC.exists():
        return []
    return sorted(p for p in ASSETS_SRC.rglob("*") if p.is_file())


def compute_source_signature(markdown_state: dict, asset_state: dict) -> str:
    payload = json.dumps(
        {
            "markdown": markdown_state,
            "assets": asset_state,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_previous_manifest() -> dict:
    manifest_path = OUT_DIR / "manifest.json"
    if not manifest_path.exists():
        return {}
    try:
        return json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    RENDERED_DIR.mkdir(parents=True, exist_ok=True)
    ASSETS_DST.mkdir(parents=True, exist_ok=True)

    state = load_state()
    old_md_state: dict = state.get("markdown", {})
    old_asset_state: dict = state.get("assets", {})

    new_md_state: dict = {}
    new_asset_state: dict = {}

    manifest: list[dict] = []
    changed_any = False

    for md_file in collect_source_markdown():
        rel = relative_posix(md_file, DOCS_DIR)
        file_hash = sha256_file(md_file)

        manifest_entry, html = render_markdown(md_file)
        slug = manifest_entry["slug"]
        out_file = RENDERED_DIR / f"{slug}.html"

        previous = old_md_state.get(rel)
        previous_hash = previous["hash"] if previous else None
        previous_slug = previous["slug"] if previous else None

        if previous_slug and previous_slug != slug:
            old_out = RENDERED_DIR / f"{previous_slug}.html"
            if old_out.exists():
                old_out.unlink()
                changed_any = True

        if previous_hash != file_hash or not out_file.exists():
            if write_text_if_changed(out_file, html):
                changed_any = True

        new_md_state[rel] = {"hash": file_hash, "slug": slug}
        manifest.append(manifest_entry)

    deleted_md = set(old_md_state) - set(new_md_state)
    for rel in deleted_md:
        old_slug = old_md_state[rel]["slug"]
        old_out = RENDERED_DIR / f"{old_slug}.html"
        if old_out.exists():
            old_out.unlink()
            changed_any = True

    for asset_file in collect_source_assets():
        rel = relative_posix(asset_file, ASSETS_SRC)
        file_hash = sha256_file(asset_file)
        dst = ASSETS_DST / rel

        previous_hash = old_asset_state.get(rel)
        if previous_hash != file_hash or not dst.exists():
            if copy_file_if_changed(asset_file, dst):
                changed_any = True

        new_asset_state[rel] = file_hash

    deleted_assets = set(old_asset_state) - set(new_asset_state)
    for rel in deleted_assets:
        dst = ASSETS_DST / rel
        if dst.exists():
            dst.unlink()
            changed_any = True

    if ASSETS_DST.exists():
        for p in sorted(ASSETS_DST.rglob("*"), reverse=True):
            if p.is_dir():
                try:
                    p.rmdir()
                except OSError:
                    pass

    manifest.sort(key=lambda x: (x["section"], x["order"], x["title"]))

    previous_manifest = load_previous_manifest()
    source_signature = compute_source_signature(new_md_state, new_asset_state)
    previous_signature = previous_manifest.get("sourceSignature")
    generated_at = previous_manifest.get("generatedAt") if previous_signature == source_signature else utc_now_iso()

    manifest_payload = {
        "generatedAt": generated_at,
        "sourceSignature": source_signature,
        "docs": manifest,
    }

    if write_text_if_changed(
        OUT_DIR / "manifest.json",
        json.dumps(manifest_payload, indent=2),
    ):
        changed_any = True

    save_state({"markdown": new_md_state, "assets": new_asset_state})

    if changed_any:
        print(f"Help docs updated. generatedAt={generated_at} sourceSignature={source_signature}")
    else:
        print(f"No help-doc changes detected. sourceSignature={source_signature}")


if __name__ == "__main__":
    main()
