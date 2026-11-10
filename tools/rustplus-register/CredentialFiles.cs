using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace RustPlusRegister;

internal sealed class InvalidCredentialsException : Exception
{
    public InvalidCredentialsException() : base("Invalid credentials file.")
    {
    }
}

internal sealed record ReusableCredentials(ulong AndroidId, ulong SecurityToken, string RegisteredAt);

internal sealed record CanonicalBundle(
    [property: JsonPropertyName("fcm_credentials")] CanonicalFcmCredentials FcmCredentials,
    [property: JsonPropertyName("registered_at")] string RegisteredAt,
    [property: JsonPropertyName("companion")] CanonicalCompanion Companion);

internal sealed record CanonicalFcmCredentials(
    [property: JsonPropertyName("gcm")] CanonicalGcm Gcm);

internal sealed record CanonicalGcm(
    [property: JsonPropertyName("androidId")] string AndroidId,
    [property: JsonPropertyName("securityToken")] string SecurityToken);

internal sealed record CanonicalCompanion(
    [property: JsonPropertyName("authToken")] string AuthToken,
    [property: JsonPropertyName("steamId")] string SteamId,
    [property: JsonPropertyName("issuedAt")] string IssuedAt,
    [property: JsonPropertyName("expiresAt")] string ExpiresAt);

internal static class CredentialFiles
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    public static ReusableCredentials LoadReuse(string path)
    {
        var json = File.ReadAllText(path);
        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                throw new InvalidCredentialsException();
            }

            JsonElement gcm;
            if (root.TryGetProperty("fcm_credentials", out var credentials) &&
                credentials.ValueKind == JsonValueKind.Object &&
                credentials.TryGetProperty("gcm", out gcm) &&
                gcm.ValueKind == JsonValueKind.Object)
            {
                // Canonical shape; the clock is optional for GCM-only converted files.
            }
            else if (root.TryGetProperty("Gcm", out gcm) && gcm.ValueKind == JsonValueKind.Object)
            {
                // Native shape; no saved clock.
            }
            else
            {
                throw new InvalidCredentialsException();
            }

            return new ReusableCredentials(
                ReadUnsigned64(gcm, "androidId", "AndroidId"),
                ReadUnsigned64(gcm, "securityToken", "SecurityToken"),
                ReadRegisteredAt(root, path));
        }
        catch (JsonException)
        {
            throw new InvalidCredentialsException();
        }
    }

    public static CanonicalBundle CreateBundle(
        ulong androidId,
        ulong securityToken,
        string authToken,
        ulong steamId,
        string registeredAt,
        DateTimeOffset issuedAt,
        DateTimeOffset expiresAt)
    {
        return new CanonicalBundle(
            new CanonicalFcmCredentials(
                new CanonicalGcm(
                    androidId.ToString(CultureInfo.InvariantCulture),
                    securityToken.ToString(CultureInfo.InvariantCulture))),
            registeredAt,
            new CanonicalCompanion(
                authToken,
                steamId.ToString(CultureInfo.InvariantCulture),
                FormatIso(issuedAt),
                FormatIso(expiresAt)));
    }

    public static string SerializeCanonical(CanonicalBundle bundle) =>
        JsonSerializer.Serialize(bundle, JsonOptions);

    public static void SaveExclusive(string path, CanonicalBundle bundle)
    {
        var payload = JsonSerializer.SerializeToUtf8Bytes(bundle, JsonOptions);
        var options = new FileStreamOptions
        {
            Mode = FileMode.CreateNew,
            Access = FileAccess.Write,
            Share = FileShare.None,
        };
        if (!OperatingSystem.IsWindows())
        {
            options.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;
        }

        var stream = new FileStream(path, options);
        try
        {
            using (stream)
            {
                stream.Write(payload);
                stream.WriteByte((byte)'\n');
                stream.Flush(flushToDisk: true);
            }

            if (!OperatingSystem.IsWindows())
            {
                File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
            }
        }
        catch
        {
            try
            {
                File.Delete(path);
            }
            catch
            {
                // Best effort: the original failure is more useful than a cleanup failure.
            }

            throw;
        }
    }

    public static string FormatIso(DateTimeOffset value) =>
        value.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);

    public static string SuccessMessage(string outputPath, DateTimeOffset expiresAt)
    {
        var expiry = expiresAt.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        return $"Saved credentials to {outputPath}\n" +
               "In RustTools, open Settings > Admin, choose the existing account, and use Renew Upload.\n" +
               "Do not Add a duplicate or delete the old slot. For a first registration with no existing slot, Add once.\n" +
               "Keep this file and any --credentials source private; never commit either. " +
               $"The Steam auth token expires around {expiry} and is not auto-renewed.";
    }

    private static string ReadRegisteredAt(JsonElement root, string path)
    {
        if (root.TryGetProperty("registered_at", out var value) ||
            root.TryGetProperty("registeredAt", out value))
        {
            if (value.ValueKind != JsonValueKind.String ||
                string.IsNullOrWhiteSpace(value.GetString()) ||
                !DateTimeOffset.TryParse(
                    value.GetString(),
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.RoundtripKind,
                    out _))
            {
                throw new InvalidCredentialsException();
            }

            return value.GetString()!.Trim();
        }

        // GCM-only files and native files have no saved clock: use file creation time as an
        // explicitly unverified estimate.
        return FormatIso(new DateTimeOffset(File.GetCreationTimeUtc(path)));
    }

    private static ulong ReadUnsigned64(JsonElement gcm, string lowerName, string upperName)
    {
        if (!gcm.TryGetProperty(lowerName, out var value) &&
            !gcm.TryGetProperty(upperName, out value))
        {
            throw new InvalidCredentialsException();
        }

        ulong parsed;
        if (value.ValueKind == JsonValueKind.Number)
        {
            if (!value.TryGetUInt64(out parsed))
            {
                throw new InvalidCredentialsException();
            }
        }
        else if (value.ValueKind == JsonValueKind.String)
        {
            var text = value.GetString();
            if (text is null ||
                !ulong.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out parsed))
            {
                throw new InvalidCredentialsException();
            }
        }
        else
        {
            throw new InvalidCredentialsException();
        }

        if (parsed == 0)
        {
            throw new InvalidCredentialsException();
        }

        return parsed;
    }
}
