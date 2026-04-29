# Help and Wizard Assets

Store source screenshots and images for the Help Docs and RTA Wizard here.

The build script copies this directory to:

```text
frontend/help/assets/
```

The live portal serves the copied files from:

```text
/help/assets/<filename>
```

Reference images from markdown like this:

```md
![Description](assets/example.png)
```

Do not manually edit generated copies under `frontend/help/assets/` or `/opt/otp-relay/frontend/help/assets/`.
