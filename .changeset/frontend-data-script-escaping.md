---
"@_linked/server-utils": patch
---

`Html` escapes `<`, `>`, `&`, U+2028 and U+2029 in the JSON it writes into the `request-json` and `request-ld` scripts (new `escapeJsonForScript` in `utils/HtmlAssets`), so a `</script>` in `frontendData` can no longer end the element. The client reads the same value back.
