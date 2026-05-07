from __future__ import annotations

import hashlib
import json
import re
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
WIZARD_GUIDE_FILE = OUT_DIR / "wizard-guide.json"

# File-level fallback is intentionally narrow. Prefer explicit
# <!-- wizard:step_id --> ... <!-- /wizard --> blocks in docs/help/*.md.
# 00-overview.md is maintainer/reference material and is never mapped by default.
DEFAULT_WIZARD_STEP_MAP = {
    "02-reset-rta-password.md": ["password_reset"],
    "03-configure-oracle-authenticator.md": ["oracle_auth"],
    "04-request-rdp-sftp-pam-access.md": ["vpn_request"],
    "05-install-rta-vpn.md": ["install_vpn"],
    "09-rta-it-support-ticket.md": ["email_support"],
}

WIZARD_BLOCK_RE = re.compile(
    r"<!--\s*wizard\s*:\s*([^>]+?)\s*-->\s*(.*?)\s*<!--\s*/wizard\s*-->",
    re.IGNORECASE | re.DOTALL,
)
HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s+(.+?)\s*$", re.MULTILINE)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def write_text_if_changed(path: Path, content: str) -> bool:
    if path.exists() and path.read_text(encoding="utf-8") == content:
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
    # Markdown docs use assets/example.png. The live portal serves generated assets
    # from /help/assets/example.png.
    return html.replace('src="assets/', 'src="/help/assets/')


def render_markdown_text(text: str) -> str:
    html = markdown.markdown(text, extensions=["extra", "tables", "fenced_code", "toc"])
    return rewrite_asset_paths(html)


def render_markdown(md_file: Path) -> tuple[dict, str]:
    meta, body = parse_markdown_file(md_file)
    slug = meta.get("slug") or md_file.stem
    section = meta.get("section", "General")
    title = meta.get("title", slug.replace("-", " ").title())
    order = int(meta.get("order", 999))

    html = render_markdown_text(body)
    manifest_entry = {
        "slug": slug,
        "title": title,
        "section": section,
        "order": order,
        "htmlPath": f"/help/rendered/{slug}.html",
    }
    return manifest_entry, html


def split_step_ids(raw_ids: str) -> list[str]:
    return [part.strip() for part in re.split(r"[,\s]+", raw_ids) if part.strip()]


def block_title(markdown_text: str, fallback: str) -> str:
    match = HEADING_RE.search(markdown_text)
    if not match:
        return fallback
    title = match.group(1).strip()
    # Remove simple Markdown emphasis/backticks from tab labels.
    title = re.sub(r"[`*_]", "", title)
    return title


def extract_wizard_blocks(body: str, fallback_title: str) -> list[dict]:
    blocks: list[dict] = []
    for idx, match in enumerate(WIZARD_BLOCK_RE.finditer(body)):
        step_ids = split_step_ids(match.group(1))
        content = match.group(2).strip()
        if not step_ids or not content:
            continue
        blocks.append({
            "stepIds": step_ids,
            "title": block_title(content, fallback_title),
            "markdown": content,
            "blockIndex": idx,
        })
    return blocks


def wizard_steps_for(md_file: Path, meta: dict) -> list[str]:
    if meta.get("wizard") is False:
        return []
    explicit = meta.get("wizard_steps")
    if isinstance(explicit, str):
        return [s.strip() for s in explicit.split(",") if s.strip()]
    if isinstance(explicit, list):
        return [str(s).strip() for s in explicit if str(s).strip()]
    return DEFAULT_WIZARD_STEP_MAP.get(md_file.name, [])


def relative_posix(path: Path, base: Path) -> str:
    return path.relative_to(base).as_posix()


def collect_source_markdown() -> list[Path]:
    return sorted(p for p in DOCS_DIR.glob("*.md") if p.is_file())


def collect_source_assets() -> list[Path]:
    if not ASSETS_SRC.exists():
        return []
    return sorted(p for p in ASSETS_SRC.rglob("*") if p.is_file())


def compute_source_signature(markdown_state: dict, asset_state: dict) -> str:
    payload = json.dumps({"markdown": markdown_state, "assets": asset_state}, sort_keys=True, separators=(",", ":"))
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


def add_wizard_page(wizard_steps: dict, step_id: str, page: dict, source_file: str) -> None:
    step = wizard_steps.setdefault(step_id, {"pages": [], "sourceFiles": []})
    step["pages"].append(page)
    if source_file not in step["sourceFiles"]:
        step["sourceFiles"].append(source_file)


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
    wizard_steps: dict[str, dict] = {}
    changed_any = False

    for md_file in collect_source_markdown():
        rel = relative_posix(md_file, DOCS_DIR)
        file_hash = sha256_file(md_file)
        meta, body = parse_markdown_file(md_file)

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

        if meta.get("wizard") is False:
            continue

        blocks = extract_wizard_blocks(body, manifest_entry["title"])
        if blocks:
            for block in blocks:
                block_html = render_markdown_text(block["markdown"])
                for step_id in block["stepIds"]:
                    add_wizard_page(
                        wizard_steps,
                        step_id,
                        {
                            "title": block["title"],
                            "section": manifest_entry["section"],
                            "order": manifest_entry["order"],
                            "blockIndex": block["blockIndex"],
                            "slug": slug,
                            "html": block_html,
                            "sourceFile": rel,
                        },
                        rel,
                    )
        else:
            # Fallback for older topic pages. New/maintained pages should use explicit
            # wizard blocks so each portal step receives only step-specific content.
            for step_id in wizard_steps_for(md_file, meta):
                add_wizard_page(
                    wizard_steps,
                    step_id,
                    {
                        "title": manifest_entry["title"],
                        "section": manifest_entry["section"],
                        "order": manifest_entry["order"],
                        "blockIndex": 0,
                        "slug": slug,
                        "html": html,
                        "sourceFile": rel,
                    },
                    rel,
                )

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
    for step in wizard_steps.values():
        step["pages"].sort(key=lambda x: (x["order"], x.get("blockIndex", 0), x["title"]))

    previous_manifest = load_previous_manifest()
    source_signature = compute_source_signature(new_md_state, new_asset_state)
    previous_signature = previous_manifest.get("sourceSignature")
    generated_at = previous_manifest.get("generatedAt") if previous_signature == source_signature else utc_now_iso()

    manifest_payload = {"generatedAt": generated_at, "sourceSignature": source_signature, "docs": manifest}
    if write_text_if_changed(OUT_DIR / "manifest.json", json.dumps(manifest_payload, indent=2)):
        changed_any = True

    wizard_payload = {"generatedAt": generated_at, "sourceSignature": source_signature, "steps": wizard_steps}
    if write_text_if_changed(WIZARD_GUIDE_FILE, json.dumps(wizard_payload, indent=2)):
        changed_any = True

    save_state({"markdown": new_md_state, "assets": new_asset_state})

    if changed_any:
        print(f"Help docs updated. generatedAt={generated_at} sourceSignature={source_signature}")
        print(f"Wizard guide written to {WIZARD_GUIDE_FILE}")
    else:
        print(f"No help-doc changes detected. sourceSignature={source_signature}")


if __name__ == "__main__":
    main()
