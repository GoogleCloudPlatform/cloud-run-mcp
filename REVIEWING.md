# Reviewing Pull Requests

This document provides guidelines for reviewing Pull Requests.

## Guidelines

### Presubmit Tests

Running presubmit tests is a mandatory requirement for Pull Requests to be eligible for submission.

**Before triggering tests:**
Review the code changes, especially new or modified tests, to ensure they do not contain any malicious or harmful code that could unnecessarily consume or harm Google's resources during test execution. In particular, ensure the tests:

- **Do not modify environment variables:** The tests should not modify environment variables in an unexpected or harmful way.
- **Do not consume excessive resources:** Ensure tests do not create an excessive number of Google Cloud projects or other high-cost resources.
- **Do not contain hardcoded credentials:** Credentials should not be present in the code.
- **Do not rely on untrusted external dependencies:** Any new external dependencies should be reviewed for trustworthiness.

**Triggering tests:**
If the code is safe to run, trigger presubmit tests by adding a comment with `kokoro:run` to the Pull Request. Tests are run via Kokoro.
