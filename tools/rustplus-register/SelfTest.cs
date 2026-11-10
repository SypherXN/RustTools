using System.Globalization;
using System.Text;
using System.Text.Json;

namespace RustPlusRegister;

internal static class SelfTest
{
    private const string SyntheticToken = "synthetic-self-test-token-not-real";
    private static readonly DateTimeOffset IssuedAt = new(2024, 1, 2, 3, 4, 5, TimeSpan.Zero);

    public static void Run()
    {
        var approved = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Temp",
            "opencode");
        var baseFolder = Directory.Exists(approved) ? approved : Path.GetTempPath();
        var folder = Path.Combine(
            baseFolder,
            "rustplus-register-selftest-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        try
        {
            TestBundleShape();
            TestReuse(folder);
            TestNoOverwrite(folder);
            TestInvalidInputs(folder);
            TestStableTimestamps();
        }
        finally
        {
            try
            {
                Directory.Delete(folder, recursive: true);
            }
            catch
            {
                // Synthetic temp files only; cleanup failure must not mask a test result.
            }
        }
    }

    private static CanonicalBundle Sample(DateTimeOffset issuedAt) =>
        CredentialFiles.CreateBundle(
            ulong.MaxValue,
            9007199254740993,
            SyntheticToken,
            76561198000000000,
            "2024-01-01T00:00:00+00:00",
            issuedAt,
            issuedAt.AddDays(14));

    private static void TestBundleShape()
    {
        var json = CredentialFiles.SerializeCanonical(Sample(IssuedAt));
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        Check(root.EnumerateObject().Count() == 3);

        var gcm = root.GetProperty("fcm_credentials").GetProperty("gcm");
        Check(gcm.GetProperty("androidId").GetString() == "18446744073709551615");
        Check(gcm.GetProperty("securityToken").GetString() == "9007199254740993");
        Check(root.GetProperty("registered_at").GetString() == "2024-01-01T00:00:00+00:00");

        var companion = root.GetProperty("companion");
        Check(companion.EnumerateObject().Count() == 4);
        Check(companion.GetProperty("authToken").GetString() == SyntheticToken);
        Check(companion.GetProperty("steamId").GetString() == "76561198000000000");
        Check(companion.GetProperty("issuedAt").GetString() == CredentialFiles.FormatIso(IssuedAt));
        Check(companion.GetProperty("expiresAt").GetString() == CredentialFiles.FormatIso(IssuedAt.AddDays(14)));
        Check(!CredentialFiles.SuccessMessage("out.json", IssuedAt.AddDays(14))
            .Contains(SyntheticToken, StringComparison.Ordinal));
    }

    private static void TestReuse(string folder)
    {
        const string native =
            "{\"Gcm\":{\"AndroidId\":18446744073709551615,\"SecurityToken\":9007199254740993}," +
            "\"Fcm\":{\"Token\":\"synthetic\"},\"ExpoPushToken\":\"ExponentPushToken[synthetic]\"}";
        var nativePath = Path.Combine(folder, "native-bom.json");
        File.WriteAllText(nativePath, native, new UTF8Encoding(encoderShouldEmitUTF8Identifier: true));
        var fromNative = CredentialFiles.LoadReuse(nativePath);
        Check(fromNative.AndroidId == ulong.MaxValue);
        Check(fromNative.SecurityToken == 9007199254740993);
        Check(DateTimeOffset.TryParse(
            fromNative.RegisteredAt,
            CultureInfo.InvariantCulture,
            DateTimeStyles.RoundtripKind,
            out _));

        const string canonical =
            "{\"fcm_credentials\":{\"gcm\":{\"androidId\":\"18446744073709551615\"," +
            "\"securityToken\":\"9007199254740993\"}}," +
            "\"registered_at\":\"2024-01-02T03:04:05+00:00\"," +
            "\"companion\":{\"authToken\":\"synthetic\",\"steamId\":\"1\"," +
            "\"issuedAt\":\"2024-01-02T03:04:05+00:00\",\"expiresAt\":\"2024-01-16T03:04:05+00:00\"}}";
        var canonicalPath = Path.Combine(folder, "canonical-bom.json");
        File.WriteAllText(canonicalPath, canonical, new UTF8Encoding(encoderShouldEmitUTF8Identifier: true));
        var fromCanonical = CredentialFiles.LoadReuse(canonicalPath);
        Check(fromCanonical.RegisteredAt == "2024-01-02T03:04:05+00:00");
        Check(fromCanonical.AndroidId == ulong.MaxValue);
        Check(fromCanonical.SecurityToken == 9007199254740993);

        const string gcmOnly =
            "{\"fcm_credentials\":{\"gcm\":{\"androidId\":\"18446744073709551615\"," +
            "\"securityToken\":\"9007199254740993\"}}}";
        var gcmOnlyPath = Path.Combine(folder, "gcm-only-bom.json");
        File.WriteAllText(gcmOnlyPath, gcmOnly, new UTF8Encoding(encoderShouldEmitUTF8Identifier: true));
        var fromGcmOnly = CredentialFiles.LoadReuse(gcmOnlyPath);
        Check(fromGcmOnly.RegisteredAt ==
              CredentialFiles.FormatIso(new DateTimeOffset(File.GetCreationTimeUtc(gcmOnlyPath))));
        Check(fromGcmOnly.AndroidId == ulong.MaxValue);
        Check(fromGcmOnly.SecurityToken == 9007199254740993);

        const string alias =
            "{\"fcm_credentials\":{\"gcm\":{\"androidId\":\"1\",\"securityToken\":\"1\"}}," +
            "\"registeredAt\":\"2024-02-03T04:05:06+00:00\"}";
        var aliasPath = Path.Combine(folder, "registered-at-alias.json");
        File.WriteAllText(aliasPath, alias, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
        var fromAlias = CredentialFiles.LoadReuse(aliasPath);
        Check(fromAlias.RegisteredAt == "2024-02-03T04:05:06+00:00");
    }

    private static void TestNoOverwrite(string folder)
    {
        var path = Path.Combine(folder, "existing.json");
        File.WriteAllText(path, "sentinel", new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
        var rejected = false;
        try
        {
            CredentialFiles.SaveExclusive(path, Sample(IssuedAt));
        }
        catch (IOException)
        {
            rejected = true;
        }

        Check(rejected);
        Check(File.ReadAllText(path) == "sentinel");
    }

    private static void TestInvalidInputs(string folder)
    {
        var cases = new[]
        {
            "[]",
            "{\"Gcm\":[]}",
            "{\"Gcm\":{}}",
            "{\"Gcm\":{\"AndroidId\":true,\"SecurityToken\":1}}",
            "{\"Gcm\":{\"AndroidId\":1.5,\"SecurityToken\":1}}",
            "{\"Gcm\":{\"AndroidId\":0,\"SecurityToken\":1}}",
            "{\"Gcm\":{\"AndroidId\":-1,\"SecurityToken\":1}}",
            "{\"Gcm\":{\"AndroidId\":18446744073709551616,\"SecurityToken\":1}}",
            "{\"Gcm\":{\"AndroidId\":\"12a\",\"SecurityToken\":1}}",
            "{\"fcm_credentials\":{\"gcm\":{\"androidId\":\"0\",\"securityToken\":\"1\"}}," +
            "\"registered_at\":\"2024-01-01T00:00:00Z\",\"companion\":{}}",
            "{\"fcm_credentials\":{\"gcm\":{\"androidId\":\"1\",\"securityToken\":\"1\"}}," +
            "\"registered_at\":\"not-a-date\"}",
            "{\"fcm_credentials\":{\"gcm\":{\"androidId\":\"1\",\"securityToken\":\"1\"}}," +
            "\"registered_at\":123}",
            "{\"fcm_credentials\":{\"gcm\":{\"androidId\":\"1\",\"securityToken\":\"1\"}}," +
            "\"registered_at\":null}",
            "{\"fcm_credentials\":{\"gcm\":{\"androidId\":\"1\",\"securityToken\":\"1\"}}," +
            "\"registeredAt\":\"not-a-date\"}",
        };

        for (var index = 0; index < cases.Length; index++)
        {
            var path = Path.Combine(folder, "bad-" + index + ".json");
            File.WriteAllText(path, cases[index], new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
            var rejected = false;
            try
            {
                CredentialFiles.LoadReuse(path);
            }
            catch (InvalidCredentialsException exception)
            {
                rejected = true;
                Check(exception.Message == "Invalid credentials file.");
            }

            Check(rejected);
        }
    }

    private static void TestStableTimestamps()
    {
        var first = CredentialFiles.SerializeCanonical(Sample(IssuedAt));
        var second = CredentialFiles.SerializeCanonical(Sample(IssuedAt));
        Check(first == second);
        Check(CredentialFiles.FormatIso(IssuedAt.AddDays(14)) ==
              "2024-01-16T03:04:05.0000000+00:00");
    }

    private static void Check(bool condition)
    {
        if (!condition)
        {
            throw new InvalidOperationException("self-test assertion failed");
        }
    }
}
