# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |

## Reporting a Vulnerability

Please report security vulnerabilities in Terrarium through [GitHub's private vulnerability reporting](https://github.com/Luckystrike561/terrarium/security/advisories/new). If the vulnerability also affects upstream Pixel Agents, report it to that project as well.

**Do not open a public issue for security vulnerabilities.**

We will acknowledge your report within 7 days and aim to release a fix within 30 days of confirmation.

## Scope

Security issues relevant to this project include:

- Command injection via terminal spawning or JSONL parsing
- Arbitrary file read/write beyond intended paths
- Cross-site scripting (XSS) in the webview
- Sensitive data exposure (e.g., leaking terminal output or session content)
