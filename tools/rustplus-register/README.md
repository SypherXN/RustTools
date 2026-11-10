# rustplus-register

Tiny local .NET 10 console app that acquires FCM + Rust+ credentials with
`RustPlusApi.Fcm.Registration` `2.0.0-beta.10` and writes the RustTools upload bundle.
It is not a Windows service or IPC server. It exits as soon as the bundle is saved;
there is no FCM listener and no server-pair wait.

## Requirements

- Run it only on your own Windows PC, not on a server.
- .NET 10 on Windows desktop (SDK to build, runtime to run).
- Edge, Chrome, Brave or Chromium. The library opens it for the Steam login.

## Run (Windows PowerShell 5)

```powershell
dotnet run --project tools/rustplus-register/RustPlusRegister.csproj -- --output "$env:LOCALAPPDATA\RustTools\rustplus-fcm.json"
```

Use a new filename each run. If the output exists, the command fails instead of overwriting.
Omit `--output` to write a timestamped file under `%LOCALAPPDATA%\RustTools`.

## Options

- `--output PATH` — new file to create. Must not already exist and must differ from `--credentials`.
- `--credentials PATH` — optional reuse of the GCM identity from either:
  - a native file with `Gcm.AndroidId` / `Gcm.SecurityToken`, or
  - a previous canonical bundle with `fcm_credentials.gcm.androidId` / `securityToken`.

  Reuse re-check-ins the existing GCM identity, refreshes the FCM/Expo tokens, then runs
  the Steam login. A valid `registered_at` (or older `registeredAt`) is preserved. If neither is
  present, including GCM-only converted files and native files, the file creation time is used
  as an unverified estimate.
- `--self-test` — offline checks using synthetic temporary files only. No network, no real
  credentials, and no file arguments.

## Output

The canonical JSON contains:

- `fcm_credentials.gcm.androidId` and `securityToken` as exact decimal strings.
- `registered_at` as an ISO timestamp.
- `companion.authToken` (the raw Steam auth token), `steamId` as an exact decimal string,
  `issuedAt` (start of the Steam login), and `expiresAt` (issuedAt + 14 days).

The file is created with `FileMode.CreateNew` and is never overwritten. On POSIX it is
created mode 0600. On Windows it relies on the per-user `%LOCALAPPDATA%` folder's inherited
private ACL; put a custom `--output` in a folder only your Windows account can read.

In RustTools, open Settings > Admin, choose the existing account, and use Renew Upload. Do not
Add a duplicate or delete the old slot. Add once only for a first registration when no slot exists.
The Steam auth token lasts about 14 days; rerun before `expiresAt` to renew. There is no auto-renew.

The CLI never prints the token. It prints only safe instructions, the output path, and the
expiry date. The output file and any `--credentials` source contain secrets: keep them
private, out of the repository, logs, and chat. Do not place an auth file in the repo.
