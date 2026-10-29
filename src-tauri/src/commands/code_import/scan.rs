//! A scanner for the languages with braces: no parser per language, just enough
//! to find declarations. Strings are skipped over (a `{` or `;` in one does not
//! count) but kept, so defaults like `"open"` survive.

/// `head { body }`, or `head;` (body None). `tail` is what follows a body up to
/// the end of the statement, e.g. the ` = new()` of a C# property.
#[derive(Debug, Clone)]
pub struct Item {
    pub head: String,
    pub body: Option<String>,
    pub tail: String,
}

impl Item {
    /// The head on one line, without annotations (`@Override`, `#[derive(..)]`).
    pub fn decl(&self) -> String {
        let mut s = String::new();
        let chars: Vec<char> = self.head.chars().collect();
        let mut i = 0;
        while i < chars.len() {
            let c = chars[i];
            // `@Name`, `@Name(...)`, `#[...]`
            if c == '@' || (c == '#' && chars.get(i + 1) == Some(&'[')) {
                i += 1;
                if c == '#' {
                    i = skip_group(&chars, i);
                } else {
                    while i < chars.len() && (chars[i].is_alphanumeric() || matches!(chars[i], '_' | '.')) {
                        i += 1;
                    }
                    if chars.get(i) == Some(&'(') {
                        i = skip_group(&chars, i);
                    }
                }
                continue;
            }
            s.push(c);
            i += 1;
        }
        s.split_whitespace().collect::<Vec<_>>().join(" ")
    }
}

/// From an opening bracket at `i`, the index just past its closing one.
fn skip_group(chars: &[char], i: usize) -> usize {
    let mut depth = 0;
    let mut j = i;
    while j < chars.len() {
        match chars[j] {
            '(' | '[' => depth += 1,
            ')' | ']' => {
                depth -= 1;
                if depth == 0 {
                    return j + 1;
                }
            }
            '"' | '\'' => j = skip_string(chars, j) - 1,
            _ => {}
        }
        j += 1;
    }
    chars.len()
}

/// From a quote at `i`, the index just past the string (or char literal).
/// A `'` that does not close within a few characters is a Rust lifetime: just itself.
fn skip_string(chars: &[char], i: usize) -> usize {
    let q = chars[i];
    if q == '"' && chars.get(i + 1) == Some(&'"') && chars.get(i + 2) == Some(&'"') {
        let end = (i + 3..chars.len().saturating_sub(2)).find(|&j| chars[j] == '"' && chars[j + 1] == '"' && chars[j + 2] == '"');
        return end.map_or(chars.len(), |j| j + 3);
    }
    let mut j = i + 1;
    while j < chars.len() && chars[j] != q && chars[j] != '\n' {
        j += if chars[j] == '\\' { 2 } else { 1 };
    }
    if q == '\'' && (j >= chars.len() || chars[j] != '\'' || j - i > 4) {
        return i + 1;
    }
    (j + 1).min(chars.len())
}

/// The code without `//` and `/* */` comments (strings left alone).
pub fn strip_comments(code: &str) -> String {
    let chars: Vec<char> = code.chars().collect();
    let mut out = String::with_capacity(code.len());
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let next = chars.get(i + 1).copied();
        if c == '/' && next == Some('/') {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
        } else if c == '/' && next == Some('*') {
            i = (i + 2..chars.len().saturating_sub(1)).find(|&j| chars[j] == '*' && chars[j + 1] == '/').map_or(chars.len(), |j| j + 2);
            out.push(' ');
        } else if c == '"' || c == '\'' || c == '`' {
            let end = if c == '`' { (i + 1..chars.len()).find(|&j| chars[j] == '`').map_or(chars.len(), |j| j + 1) } else { skip_string(&chars, i) };
            out.extend(&chars[i..end]);
            i = end;
        } else {
            out.push(c);
            i += 1;
        }
    }
    out
}

/// The items in a block. With `lines`, a line end also ends an item (TypeScript,
/// Kotlin, Go), unless the line clearly goes on: inside brackets, after a `,` or
/// `=`, or when the next line starts with `{`, `.`, `:` or `=`.
pub fn items(src: &str, lines: bool) -> Vec<Item> {
    let chars: Vec<char> = src.chars().collect();
    let mut out = vec![];
    let mut head = String::new();
    let mut depth = 0i32; // ( and [
    let mut i = 0;
    let push = |out: &mut Vec<Item>, head: &mut String, body: Option<String>, tail: String| {
        if !head.trim().is_empty() || body.is_some() {
            out.push(Item { head: head.trim().to_string(), body, tail });
        }
        head.clear();
    };
    while i < chars.len() {
        let c = chars[i];
        match c {
            '"' | '\'' | '`' => {
                let end = if c == '`' { (i + 1..chars.len()).find(|&j| chars[j] == '`').map_or(chars.len(), |j| j + 1) } else { skip_string(&chars, i) };
                head.extend(&chars[i..end]);
                i = end;
                continue;
            }
            '(' | '[' => depth += 1,
            ')' | ']' => depth -= 1,
            '{' if depth <= 0 => {
                let end = block_end(&chars, i);
                let body: String = chars[i + 1..end.saturating_sub(1).max(i + 1)].iter().collect();
                i = end;
                // ` = default;` after a property's accessors
                let mut tail = String::new();
                let rest = chars[i..].iter().position(|c| !c.is_whitespace()).map(|p| i + p);
                if let Some(r) = rest.filter(|&r| chars[r] == '=' && chars.get(r + 1) != Some(&'>')) {
                    let stop = (r..chars.len()).find(|&j| chars[j] == ';' || (lines && chars[j] == '\n')).unwrap_or(chars.len());
                    tail = chars[r + 1..stop].iter().collect::<String>().trim().to_string();
                    i = stop + 1;
                } else if let Some(r) = rest.filter(|&r| chars[r] == ';') {
                    i = r + 1;
                }
                push(&mut out, &mut head, Some(body), tail);
                continue;
            }
            ';' if depth <= 0 => {
                push(&mut out, &mut head, None, String::new());
                i += 1;
                continue;
            }
            '\n' if lines && depth <= 0 => {
                let ends_open = head.trim_end().ends_with([',', '=', ':', '(', '|', '&', '+', '-', '.', '>']) && !head.trim_end().ends_with("->");
                let next = chars[i..].iter().find(|c| !c.is_whitespace()).copied();
                let goes_on = matches!(next, Some('{' | '.' | ':' | '=' | '|' | '?'));
                if !head.trim().is_empty() && !ends_open && !goes_on {
                    push(&mut out, &mut head, None, String::new());
                    i += 1;
                    continue;
                }
            }
            _ => {}
        }
        head.push(c);
        i += 1;
    }
    push(&mut out, &mut head, None, String::new());
    out
}

/// From a `{` at `i`, the index just past its `}`.
fn block_end(chars: &[char], i: usize) -> usize {
    let mut depth = 0;
    let mut j = i;
    while j < chars.len() {
        match chars[j] {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return j + 1;
                }
            }
            '"' | '\'' | '`' => {
                j = if chars[j] == '`' { (j + 1..chars.len()).find(|&k| chars[k] == '`').map_or(chars.len(), |k| k + 1) } else { skip_string(chars, j) };
                continue;
            }
            _ => {}
        }
        j += 1;
    }
    chars.len()
}

/// Splits on `sep` outside brackets and strings: `a: Map<K, V>, b: int` → two.
pub fn split_top(s: &str, sep: char) -> Vec<String> {
    let chars: Vec<char> = s.chars().collect();
    let (mut out, mut cur, mut depth) = (vec![], String::new(), 0i32);
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        match c {
            '"' | '\'' => {
                let end = skip_string(&chars, i);
                cur.extend(&chars[i..end]);
                i = end;
                continue;
            }
            '(' | '[' | '{' | '<' => depth += 1,
            ')' | ']' | '}' => depth -= 1,
            // not the `>` of `->` or `=>`
            '>' if i == 0 || !matches!(chars[i - 1], '-' | '=') => depth -= 1,
            _ if c == sep && depth <= 0 => {
                out.push(std::mem::take(&mut cur).trim().to_string());
                i += 1;
                continue;
            }
            _ => {}
        }
        cur.push(c);
        i += 1;
    }
    if !cur.trim().is_empty() {
        out.push(cur.trim().to_string());
    }
    out.retain(|p| !p.is_empty());
    out
}

/// The text in the brackets that start at the first `open` in `s`, and what follows them.
pub fn group<'a>(s: &'a str, open: char) -> Option<(&'a str, &'a str, &'a str)> {
    let close = match open {
        '(' => ')',
        '<' => '>',
        '[' => ']',
        _ => '}',
    };
    let start = s.find(open)?;
    let mut depth = 0;
    for (j, c) in s[start..].char_indices() {
        if c == open {
            depth += 1;
        } else if c == close && !(close == '>' && s[..start + j].ends_with('-')) {
            depth -= 1;
            if depth == 0 {
                return Some((&s[..start], &s[start + 1..start + j], &s[start + j + 1..]));
            }
        }
    }
    None
}

/// Leading words that are in `set`, and the rest.
pub fn modifiers<'a>(s: &'a str, set: &[&str]) -> (Vec<&'a str>, &'a str) {
    let mut rest = s.trim();
    let mut mods = vec![];
    loop {
        let word = rest.split_whitespace().next().unwrap_or("");
        if !word.is_empty() && set.contains(&word) {
            mods.push(word);
            rest = rest[word.len()..].trim_start();
        } else {
            return (mods, rest);
        }
    }
}
