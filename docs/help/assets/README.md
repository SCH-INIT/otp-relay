# Help Assets

Store screenshots and images for the RTA guide in this folder.

These assets are copied by:

```bash
python3 scripts/build_help_docs.py
```

from:

```text
docs/help/assets/
```

to:

```text
frontend/help/assets/
```

The RTA Wizard floating guide can reference them in markdown like this:

```md
![VPN request form](assets/vpn-request-form-details.png)
```

The build rewrites that path to:

```text
/help/assets/vpn-request-form-details.png
```

When updating screenshots:

1. Add or replace the PNG in `docs/help/assets/`.
2. Reference it from the relevant `docs/help/*.md` file.
3. Run `python3 scripts/build_help_docs.py`.
4. Deploy the portal UI.
