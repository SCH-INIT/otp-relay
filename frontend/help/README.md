# Generated help output

This directory is generated and deployed by the GitHub Actions help-docs workflow.

Do not author content here directly.

The normal portal navigation no longer exposes a standalone Help section. The RTA Wizard guide overlay in `frontend/app.jsx` is the primary user-facing guide.

This generated folder is still important because the wizard overlay loads screenshots from:

```text
/help/assets/
```

Those files are copied from `docs/help/assets/` by:

```bash
python3 scripts/build_help_docs.py
```

Markdown pages in `docs/help/` are optional rendered reference/fallback pages. They are generated into `frontend/help/rendered/`, but they are no longer the primary user-facing Help experience.
