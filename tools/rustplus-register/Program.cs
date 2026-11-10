using System.Globalization;
using RustPlusApi.Fcm.Data;
using RustPlusApi.Fcm.Registration;
using RustPlusApi.Fcm.Registration.Steps;

namespace RustPlusRegister;

internal static class Program
{
    private const string Usage = """
        Usage: rustplus-register [--credentials PATH] [--output PATH] [--self-test]
          --credentials  Reuse the GCM identity from a native or previous canonical JSON file.
          --output       New output file. Default: LocalAppData\RustTools\rustplus-fcm-<time>.json
          --self-test    Offline checks using synthetic temporary files only.
        """;

    private sealed record Options(string? CredentialsPath, string? OutputPath, bool SelfTest);

    private static async Task<int> Main(string[] args)
    {
        try
        {
            return await RunAsync(args);
        }
        catch (OperationCanceledException)
        {
            Console.WriteLine("Cancelled.");
            return 130;
        }
        catch (Exception)
        {
            Console.Error.WriteLine("error: registration failed. No credentials were printed.");
            return 1;
        }
    }

    private static async Task<int> RunAsync(string[] args)
    {
        if (args.Any(argument => argument is "--help" or "-h"))
        {
            Console.WriteLine(Usage);
            return 0;
        }

        if (!TryParse(args, out var options, out var error))
        {
            Console.Error.WriteLine("error: " + error);
            Console.Error.WriteLine(Usage);
            return 2;
        }

        if (options.SelfTest)
        {
            SelfTest.Run();
            Console.WriteLine("Self-test passed.");
            return 0;
        }

        var outputPath = options.OutputPath is null ? DefaultOutputPath() : Path.GetFullPath(options.OutputPath);
        var inputPath = options.CredentialsPath is null ? null : Path.GetFullPath(options.CredentialsPath);
        if (inputPath is not null && PathsEqual(inputPath, outputPath))
        {
            Console.Error.WriteLine("error: input and output must differ.");
            return 1;
        }

        if (File.Exists(outputPath))
        {
            Console.Error.WriteLine("error: output already exists; choose a new path.");
            return 1;
        }

        ReusableCredentials? reuse = null;
        if (inputPath is not null)
        {
            try
            {
                reuse = CredentialFiles.LoadReuse(inputPath);
            }
            catch (InvalidCredentialsException)
            {
                Console.Error.WriteLine("error: invalid credentials file.");
                return 1;
            }
            catch (Exception)
            {
                Console.Error.WriteLine("error: could not read credentials file.");
                return 1;
            }
        }

        try
        {
            var folder = Path.GetDirectoryName(outputPath);
            if (folder is not null)
            {
                Directory.CreateDirectory(folder);
            }
        }
        catch (Exception)
        {
            Console.Error.WriteLine("error: could not prepare output folder.");
            return 1;
        }

        using var cts = new CancellationTokenSource();
        Console.CancelKeyPress += (_, eventArgs) =>
        {
            if (cts.IsCancellationRequested)
            {
                return;
            }

            eventArgs.Cancel = true;
            cts.Cancel();
        };
        var cancellationToken = cts.Token;
        var registration = new FcmRegistration();

        Credentials credentials;
        string registeredAt;
        try
        {
            if (reuse is null)
            {
                var startedAt = DateTimeOffset.UtcNow;
                credentials = await registration.AcquireCredentialsAsync(cancellationToken);
                registeredAt = CredentialFiles.FormatIso(startedAt);
            }
            else
            {
                credentials = await ReuseGcmAsync(reuse, cancellationToken);
                registeredAt = reuse.RegisteredAt;
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            Console.WriteLine("Cancelled.");
            return 130;
        }
        catch (Exception)
        {
            Console.Error.WriteLine("error: FCM credential acquisition failed. No file was written.");
            return 1;
        }

        if (credentials.Gcm is null || credentials.Gcm.AndroidId == 0 || credentials.Gcm.SecurityToken == 0)
        {
            Console.Error.WriteLine("error: acquired credentials were invalid. No file was written.");
            return 1;
        }

        var issuedAt = DateTimeOffset.UtcNow;
        SteamLoginResult login;
        try
        {
            login = await registration.RegisterWithRustPlusAsync(
                credentials,
                _ => Console.WriteLine("Complete the Steam login in the browser prompt."),
                cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            Console.WriteLine("Cancelled.");
            return 130;
        }
        catch (Exception)
        {
            Console.Error.WriteLine("error: Steam login or Rust+ registration failed. No file was written.");
            return 1;
        }

        var expiresAt = issuedAt.AddDays(14);
        if (login.SteamId == 0 || string.IsNullOrWhiteSpace(login.Token))
        {
            Console.Error.WriteLine("error: Steam login returned an invalid identity. No file was written.");
            return 1;
        }

        var bundle = CredentialFiles.CreateBundle(
            credentials.Gcm.AndroidId,
            credentials.Gcm.SecurityToken,
            login.Token,
            login.SteamId,
            registeredAt,
            issuedAt,
            expiresAt);

        try
        {
            CredentialFiles.SaveExclusive(outputPath, bundle);
        }
        catch (Exception)
        {
            Console.Error.WriteLine("error: could not create output file (it must not already exist).");
            return 1;
        }

        Console.WriteLine(CredentialFiles.SuccessMessage(outputPath, expiresAt));
        return 0;
    }

    private static async Task<Credentials> ReuseGcmAsync(ReusableCredentials reuse, CancellationToken cancellationToken)
    {
        var register = new AndroidFcmRegister();
        var gcm = await register.CheckInAsync(
            new Gcm { AndroidId = reuse.AndroidId, SecurityToken = reuse.SecurityToken },
            cancellationToken);
        var firebaseToken = await register.InstallAsync(cancellationToken);
        var fcmToken = await register.RegisterFcmAsync(gcm, firebaseToken, cancellationToken);
        var expoToken = await new ExpoPushClient().GetTokenAsync(fcmToken, cancellationToken);
        return new Credentials
        {
            Gcm = gcm,
            Fcm = new FcmToken { Token = fcmToken },
            ExpoPushToken = expoToken,
        };
    }

    private static string DefaultOutputPath()
    {
        var folder = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "RustTools");
        var name = "rustplus-fcm-" +
                   DateTimeOffset.Now.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture) +
                   ".json";
        return Path.Combine(folder, name);
    }

    private static bool PathsEqual(string left, string right) =>
        string.Equals(
            left,
            right,
            OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal);

    private static bool TryParse(string[] args, out Options options, out string error)
    {
        string? credentials = null;
        string? output = null;
        var selfTest = false;

        for (var index = 0; index < args.Length; index++)
        {
            switch (args[index])
            {
                case "--self-test":
                    selfTest = true;
                    break;
                case "--credentials":
                    if (index + 1 >= args.Length)
                    {
                        options = new Options(null, null, false);
                        error = "--credentials needs a path.";
                        return false;
                    }

                    credentials = args[++index];
                    break;
                case "--output":
                    if (index + 1 >= args.Length)
                    {
                        options = new Options(null, null, false);
                        error = "--output needs a path.";
                        return false;
                    }

                    output = args[++index];
                    break;
                default:
                    options = new Options(null, null, false);
                    error = "unknown argument.";
                    return false;
            }
        }

        if (selfTest && (credentials is not null || output is not null))
        {
            options = new Options(null, null, false);
            error = "--self-test does not take file arguments.";
            return false;
        }

        options = new Options(credentials, output, selfTest);
        error = "";
        return true;
    }
}
