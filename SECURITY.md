# Security policy

## Supported version

Security fixes target the latest commit on the default branch.

## Reporting a vulnerability

Please do not disclose a vulnerability in a public issue. Use the repository's
private vulnerability-reporting flow:

<https://github.com/ussumant/object-forge/security/advisories/new>

Include reproduction steps, affected files or endpoints, and the expected
impact. Do not attach private source photos, videos, provider transcripts, API
keys, or local project data unless explicitly requested through a secure
channel.

## Sensitive boundaries

Object Forge starts authenticated local CLI processes and handles user-supplied
media and generated code. Changes involving process arguments, workspace
isolation, file paths, uploads, imports, preview bundling, or exports should be
treated as security-sensitive and tested against malformed input.
