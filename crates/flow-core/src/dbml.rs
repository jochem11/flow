//! DBML, the language of dbdiagram.io and others: read into an EER diagram, and
//! written from one.
//!
//! Read: tables with their columns and settings (`pk`, `increment`, `not null`,
//! `unique`, `default`, `note`, inline `ref`), a table's `Note` and `indexes`,
//! `Ref`s (`>` many-to-one, `<` one-to-many, `-` one-to-one, `<>` many-to-many),
//! and `TableGroup`s, which become sections. Enum columns become text; projects,
//! sticky notes and other blocks are skipped, with a note on what was.

use std::collections::{BTreeMap, HashMap};

use crate::eer::index_name;
use crate::models::{
    Attribute, Cardinality, ColumnPair, DataType, EerDoc, EerSection, Entity, RefAction, Relation,
    SqlImport, TableIndex,
};
use crate::sql_import::{layout, map_type};

fn uid() -> String {
    uuid::Uuid::new_v4().to_string()
}

// ===========================================================================
// Reading
// ===========================================================================

#[derive(Debug, Clone, PartialEq)]
enum Tok {
    /// A name, keyword or number (also a "quoted name")
    Word(String),
    /// 'text' or '''text'''
    Str(String),
    /// `an expression`
    Expr(String),
    /// `<>`
    ManyToMany,
    Sym(char),
    Newline,
}

fn tokens(src: &str) -> Vec<Tok> {
    let c: Vec<char> = src.chars().collect();
    let mut out = vec![];
    let mut i = 0;
    let until = |from: usize, end: &[char]| -> usize {
        let mut j = from;
        while j < c.len() && !c[j..].starts_with(end) {
            j += 1;
        }
        j
    };
    while i < c.len() {
        let ch = c[i];
        if ch == '\n' {
            if out.last() != Some(&Tok::Newline) {
                out.push(Tok::Newline);
            }
            i += 1;
        } else if ch.is_whitespace() {
            i += 1;
        } else if c[i..].starts_with(&['/', '/']) {
            i = until(i, &['\n']);
        } else if c[i..].starts_with(&['/', '*']) {
            i = until(i + 2, &['*', '/']) + 2;
        } else if c[i..].starts_with(&['\'', '\'', '\'']) {
            let end = until(i + 3, &['\'', '\'', '\'']);
            out.push(Tok::Str(
                c[i + 3..end.min(c.len())]
                    .iter()
                    .collect::<String>()
                    .trim()
                    .to_string(),
            ));
            i = end + 3;
        } else if ch == '\'' || ch == '"' || ch == '`' {
            let mut s = String::new();
            i += 1;
            while i < c.len() && c[i] != ch {
                if c[i] == '\\' && i + 1 < c.len() {
                    i += 1;
                }
                s.push(c[i]);
                i += 1;
            }
            i += 1;
            out.push(match ch {
                '\'' => Tok::Str(s),
                '`' => Tok::Expr(s),
                _ => Tok::Word(s),
            });
        } else if c[i..].starts_with(&['<', '>']) {
            out.push(Tok::ManyToMany);
            i += 2;
        } else if ch.is_alphanumeric()
            || ch == '_'
            || ch == '$'
            || (ch == '-'
                && c.get(i + 1).is_some_and(|d| d.is_ascii_digit())
                && out.last() == Some(&Tok::Sym(':')))
        {
            let start = i;
            // A number may have a decimal point (`0.5`); in a name a dot separates parts
            let numeric = ch.is_ascii_digit() || ch == '-';
            i += 1;
            while i < c.len()
                && (c[i].is_alphanumeric()
                    || c[i] == '_'
                    || c[i] == '$'
                    || (numeric && c[i] == '.' && c.get(i + 1).is_some_and(|d| d.is_ascii_digit())))
            {
                i += 1;
            }
            out.push(Tok::Word(c[start..i].iter().collect()));
        } else {
            out.push(Tok::Sym(ch));
            i += 1;
        }
    }
    out
}

/// A relation as written: the tables and columns on both sides, and how they relate
struct RefDef {
    left: (String, Vec<String>),
    op: Tok,
    right: (String, Vec<String>),
    name: Option<String>,
    on_delete: RefAction,
    on_update: RefAction,
}

#[derive(Default)]
struct Reader {
    t: Vec<Tok>,
    i: usize,
    entities: Vec<Entity>,
    refs: Vec<RefDef>,
    groups: Vec<(String, Vec<String>)>,
    enums: Vec<String>,
    skipped: Vec<String>,
}

/// Reads DBML: the tables, relations and groups in it, laid out (groups side by side, each in a section).
pub fn read_dbml(src: &str) -> SqlImport {
    let mut r = Reader {
        t: tokens(src),
        ..Reader::default()
    };
    // Enums first: a table may use one declared further down
    r.enums =
        r.t.windows(2)
            .filter_map(|w| match w {
                [Tok::Word(k), Tok::Word(n)] if k.eq_ignore_ascii_case("enum") => {
                    Some(n.to_lowercase())
                }
                _ => None,
            })
            .collect();
    r.top();
    r.finish()
}

impl Reader {
    fn peek(&self) -> Option<&Tok> {
        self.t.get(self.i)
    }
    fn next(&mut self) -> Option<Tok> {
        let t = self.t.get(self.i).cloned();
        self.i += 1;
        t
    }
    fn is_sym(&self, c: char) -> bool {
        self.peek() == Some(&Tok::Sym(c))
    }
    fn eat(&mut self, c: char) -> bool {
        let yes = self.is_sym(c);
        if yes {
            self.i += 1;
        }
        yes
    }
    fn skip_newlines(&mut self) {
        while self.peek() == Some(&Tok::Newline) {
            self.i += 1;
        }
    }
    fn word(&mut self) -> Option<String> {
        match self.peek() {
            Some(Tok::Word(w)) => {
                let w = w.clone();
                self.i += 1;
                Some(w)
            }
            _ => None,
        }
    }
    /// `schema.table` or `table`: the last part
    fn name(&mut self) -> Option<String> {
        let mut last = self.word()?;
        while self.is_sym('.') && matches!(self.t.get(self.i + 1), Some(Tok::Word(_))) {
            self.i += 1;
            last = self.word()?;
        }
        Some(last)
    }
    /// Past the block that starts here (or the rest of the line when no `{` comes first)
    fn skip_block(&mut self) {
        while let Some(t) = self.peek() {
            match t {
                Tok::Newline => return,
                Tok::Sym('{') => break,
                _ => self.i += 1,
            }
        }
        let mut depth = 0;
        while let Some(t) = self.next() {
            match t {
                Tok::Sym('{') => depth += 1,
                Tok::Sym('}') => {
                    depth -= 1;
                    if depth == 0 {
                        return;
                    }
                }
                _ => {}
            }
        }
    }
    /// `[ a, b: c, ... ]` as its items, each a list of tokens
    fn settings(&mut self) -> Vec<Vec<Tok>> {
        let mut items = vec![];
        if !self.eat('[') {
            return items;
        }
        let mut item = vec![];
        let mut depth = 0;
        while let Some(t) = self.next() {
            match &t {
                Tok::Sym(']') if depth == 0 => break,
                Tok::Sym(',') if depth == 0 => items.push(std::mem::take(&mut item)),
                Tok::Sym('(') | Tok::Sym('[') => {
                    depth += 1;
                    item.push(t);
                }
                Tok::Sym(')') | Tok::Sym(']') => {
                    depth -= 1;
                    item.push(t);
                }
                Tok::Newline => {}
                _ => item.push(t),
            }
        }
        if !item.is_empty() {
            items.push(item);
        }
        items
    }

    fn top(&mut self) {
        loop {
            self.skip_newlines();
            let Some(t) = self.peek().cloned() else {
                return;
            };
            match t {
                Tok::Word(w) => match w.to_lowercase().as_str() {
                    "table" => {
                        self.i += 1;
                        self.table();
                    }
                    "ref" => {
                        self.i += 1;
                        self.reference();
                    }
                    "tablegroup" => {
                        self.i += 1;
                        self.group();
                    }
                    "enum" => self.skip_block(),
                    "project" => self.skip_block(),
                    other => {
                        self.skipped
                            .push(format!("{other} … is not in the diagram"));
                        self.skip_block();
                    }
                },
                _ => {
                    self.i += 1;
                }
            }
        }
    }

    fn table(&mut self) {
        let Some(name) = self.name() else {
            return self.skip_block();
        };
        if matches!(self.peek(), Some(Tok::Word(w)) if w.eq_ignore_ascii_case("as")) {
            self.i += 1;
            self.word();
        }
        self.settings();
        self.skip_newlines();
        if !self.eat('{') {
            return;
        }
        let mut e = Entity {
            id: uid(),
            name: name.clone(),
            x: 0.0,
            y: 0.0,
            attributes: vec![],
            color: None,
            tint: None,
            comment: None,
            indexes: vec![],
        };
        let mut index_defs: Vec<(Vec<String>, bool, String, bool)> = vec![];
        loop {
            self.skip_newlines();
            if self.eat('}') || self.peek().is_none() {
                break;
            }
            let Some(first) = self.word() else {
                self.i += 1;
                continue;
            };
            let key = first.to_lowercase();
            if key == "note" && (self.is_sym(':') || self.is_sym('{')) {
                let block = self.eat('{');
                self.eat(':');
                self.skip_newlines();
                if let Some(Tok::Str(s)) = self.peek().cloned() {
                    e.comment = Some(s);
                    self.i += 1;
                }
                if block {
                    self.skip_newlines();
                    self.eat('}');
                }
                continue;
            }
            if key == "indexes" && {
                self.skip_newlines();
                self.is_sym('{')
            } {
                self.i += 1;
                index_defs.extend(self.indexes());
                continue;
            }
            // A column: name, type, settings
            let mut ty = String::new();
            while let Some(t) = self.peek() {
                match t {
                    Tok::Newline | Tok::Sym('[') | Tok::Sym('}') => break,
                    Tok::Word(w) => {
                        if !ty.is_empty() && !ty.ends_with('(') && !ty.ends_with(',') {
                            ty.push(' ');
                        }
                        ty.push_str(w);
                    }
                    Tok::Sym(c) => ty.push(*c),
                    _ => {}
                }
                self.i += 1;
            }
            let settings = self.settings();
            let a = self.column(&name, first, &ty, settings);
            e.attributes.push(a);
        }
        for (cols, unique, iname, pk) in index_defs {
            let ids: Option<Vec<String>> = cols
                .iter()
                .map(|c| {
                    e.attributes
                        .iter()
                        .find(|a| a.name.eq_ignore_ascii_case(c))
                        .map(|a| a.id.clone())
                })
                .collect();
            let Some(ids) = ids else {
                self.skipped.push(format!(
                    "{name}: index on unknown columns ({})",
                    cols.join(", ")
                ));
                continue;
            };
            if pk {
                for a in e.attributes.iter_mut().filter(|a| ids.contains(&a.id)) {
                    a.primary_key = true;
                    a.nullable = false;
                }
            } else if unique && ids.len() == 1 && iname.is_empty() {
                if let Some(a) = e.attributes.iter_mut().find(|a| a.id == ids[0]) {
                    a.unique = true;
                }
            } else {
                let names: Vec<&str> = cols.iter().map(String::as_str).collect();
                let iname = if iname.eq_ignore_ascii_case(&index_name(&name, &names)) {
                    String::new()
                } else {
                    iname
                };
                e.indexes.push(TableIndex {
                    id: uid(),
                    name: iname,
                    columns: ids,
                    unique,
                });
            }
        }
        if self
            .entities
            .iter()
            .any(|x| x.name.eq_ignore_ascii_case(&name))
        {
            self.skipped.push(format!(
                "Table {name} is there twice; only the first is used"
            ));
        } else {
            self.entities.push(e);
        }
    }

    /// `indexes { ... }`: per line the column(s) and settings (columns, unique, name, pk)
    fn indexes(&mut self) -> Vec<(Vec<String>, bool, String, bool)> {
        let mut out = vec![];
        loop {
            self.skip_newlines();
            if self.eat('}') || self.peek().is_none() {
                break;
            }
            let mut cols = vec![];
            let mut expression = false;
            if self.eat('(') {
                while let Some(t) = self.next() {
                    match t {
                        Tok::Sym(')') => break,
                        Tok::Word(w) => cols.push(w),
                        Tok::Expr(_) => expression = true,
                        _ => {}
                    }
                }
            } else {
                match self.next() {
                    Some(Tok::Word(w)) => cols.push(w),
                    Some(Tok::Expr(_)) => expression = true,
                    _ => {}
                }
            }
            let mut unique = false;
            let mut pk = false;
            let mut name = String::new();
            for item in self.settings() {
                let key = item_key(&item);
                match key.as_str() {
                    "unique" => unique = true,
                    "pk" => pk = true,
                    "name" => name = item_value(&item),
                    _ => {}
                }
            }
            if expression {
                self.skipped
                    .push("An index on an expression is not in the diagram".into());
            } else if !cols.is_empty() {
                out.push((cols, unique, name, pk));
            }
        }
        out
    }

    fn column(
        &mut self,
        table: &str,
        name: String,
        ty: &str,
        settings: Vec<Vec<Tok>>,
    ) -> Attribute {
        let mapped = map_type(ty);
        let (data_type, length, scale, serial) =
            mapped.unwrap_or((DataType::Varchar, None, None, false));
        if mapped.is_none() {
            let base = ty.split('(').next().unwrap_or("").trim().to_lowercase();
            if self.enums.contains(&base) {
                self.skipped
                    .push(format!("{table}.{name}: enum {ty} is kept as varchar"));
            } else {
                self.skipped
                    .push(format!("{table}.{name}: type {ty} is kept as varchar"));
            }
        }
        let mut a = Attribute {
            id: uid(),
            name: name.clone(),
            data_type,
            length,
            scale,
            primary_key: false,
            nullable: true,
            unique: false,
            auto_increment: serial,
            default_value: None,
        };
        for item in settings {
            match item_key(&item).as_str() {
                "pk" | "primary key" => {
                    a.primary_key = true;
                    a.nullable = false;
                }
                "increment" => a.auto_increment = true,
                "not null" => a.nullable = false,
                "null" => a.nullable = true,
                "unique" => a.unique = true,
                "default" => {
                    a.default_value = match item.iter().skip_while(|t| **t != Tok::Sym(':')).nth(1)
                    {
                        Some(Tok::Str(s)) => Some(s.clone()),
                        Some(Tok::Expr(e)) => Some(e.clone()),
                        Some(_) => Some(item_value(&item)),
                        None => None,
                    }
                    .filter(|v| !v.eq_ignore_ascii_case("null"))
                }
                "ref" => {
                    // `ref: > other.id`: this column refers to that one
                    let rest: Vec<Tok> = item
                        .iter()
                        .skip_while(|t| **t != Tok::Sym(':'))
                        .skip(1)
                        .cloned()
                        .collect();
                    if let Some((op, target)) = rest.split_first() {
                        let parts: Vec<String> = target
                            .iter()
                            .filter_map(|t| {
                                if let Tok::Word(w) = t {
                                    Some(w.clone())
                                } else {
                                    None
                                }
                            })
                            .collect();
                        if parts.len() >= 2 {
                            self.refs.push(RefDef {
                                left: (table.to_string(), vec![name.clone()]),
                                op: op.clone(),
                                right: (
                                    parts[parts.len() - 2].clone(),
                                    vec![parts[parts.len() - 1].clone()],
                                ),
                                name: None,
                                on_delete: RefAction::NoAction,
                                on_update: RefAction::NoAction,
                            });
                        }
                    }
                }
                _ => {}
            }
        }
        a
    }

    /// `table.column` or `table.(a, b)`, with an optional schema in front
    fn endpoint(&mut self) -> Option<(String, Vec<String>)> {
        let mut parts = vec![self.word()?];
        while self.eat('.') {
            if self.eat('(') {
                let mut cols = vec![];
                while let Some(t) = self.next() {
                    match t {
                        Tok::Sym(')') => break,
                        Tok::Word(w) => cols.push(w),
                        _ => {}
                    }
                }
                return Some((parts.pop()?, cols));
            }
            parts.push(self.word()?);
        }
        let col = parts.pop()?;
        Some((parts.pop()?, vec![col]))
    }

    fn reference(&mut self) {
        let name = match self.peek() {
            Some(Tok::Word(_)) => self.word(),
            _ => None,
        };
        let block = self.eat('{');
        if !block {
            self.eat(':');
        }
        loop {
            self.skip_newlines();
            if block && self.eat('}') {
                return;
            }
            let Some(left) = self.endpoint() else {
                return self.skip_block();
            };
            let op = match self.next() {
                Some(t @ (Tok::Sym('>' | '<' | '-') | Tok::ManyToMany)) => t,
                _ => return self.skip_block(),
            };
            let Some(right) = self.endpoint() else {
                return self.skip_block();
            };
            let (mut on_delete, mut on_update) = (RefAction::NoAction, RefAction::NoAction);
            for item in self.settings() {
                let action = ref_action(&item_value(&item));
                match item_key(&item).as_str() {
                    "delete" => on_delete = action,
                    "update" => on_update = action,
                    _ => {}
                }
            }
            self.refs.push(RefDef {
                left,
                op,
                right,
                name: name.clone(),
                on_delete,
                on_update,
            });
            if !block {
                return;
            }
        }
    }

    fn group(&mut self) {
        let name = self.name().unwrap_or_default();
        self.settings();
        self.skip_newlines();
        if !self.eat('{') {
            return;
        }
        let mut tables = vec![];
        loop {
            self.skip_newlines();
            if self.eat('}') || self.peek().is_none() {
                break;
            }
            match self.name() {
                Some(n) => tables.push(n),
                None => self.i += 1,
            }
        }
        self.groups.push((name, tables));
    }

    fn finish(mut self) -> SqlImport {
        let find = |entities: &[Entity], name: &str| {
            entities
                .iter()
                .position(|e| e.name.eq_ignore_ascii_case(name))
        };
        let mut relations = vec![];
        for r in std::mem::take(&mut self.refs) {
            let (Some(li), Some(ri)) = (
                find(&self.entities, &r.left.0),
                find(&self.entities, &r.right.0),
            ) else {
                self.skipped.push(format!(
                    "Ref {}.{} – {}.{}: a table is not there",
                    r.left.0,
                    r.left.1.join(","),
                    r.right.0,
                    r.right.1.join(",")
                ));
                continue;
            };
            // Which side holds the foreign key ("from")
            let (from, from_cols, to, to_cols, fc, tc) = match r.op {
                Tok::Sym('<') => (
                    ri,
                    &r.right.1,
                    li,
                    &r.left.1,
                    Cardinality::Many,
                    Cardinality::One,
                ),
                Tok::Sym('-') => (
                    li,
                    &r.left.1,
                    ri,
                    &r.right.1,
                    Cardinality::One,
                    Cardinality::One,
                ),
                Tok::ManyToMany => (
                    li,
                    &r.left.1,
                    ri,
                    &r.right.1,
                    Cardinality::Many,
                    Cardinality::Many,
                ),
                _ => (
                    li,
                    &r.left.1,
                    ri,
                    &r.right.1,
                    Cardinality::Many,
                    Cardinality::One,
                ),
            };
            let col = |e: &Entity, n: &str| {
                e.attributes
                    .iter()
                    .find(|a| a.name.eq_ignore_ascii_case(n))
                    .map(|a| a.id.clone())
            };
            let columns: Vec<ColumnPair> = if tc.is_many() && fc.is_many() {
                vec![]
            } else {
                from_cols
                    .iter()
                    .zip(to_cols)
                    .filter_map(|(a, b)| {
                        Some(ColumnPair {
                            from: col(&self.entities[from], a)?,
                            to: col(&self.entities[to], b)?,
                        })
                    })
                    .collect()
            };
            relations.push(Relation {
                id: uid(),
                from: self.entities[from].id.clone(),
                to: self.entities[to].id.clone(),
                from_cardinality: fc,
                to_cardinality: tc,
                label: r.name.filter(|n| !n.is_empty()),
                columns,
                on_delete: r.on_delete,
                on_update: r.on_update,
            });
        }

        // Groups side by side, each laid out on its own inside its section; the rest after them
        const PAD: f64 = 30.0;
        const TITLE: f64 = 50.0;
        let mut blocks: Vec<(Option<String>, Vec<usize>)> = vec![];
        let mut placed = vec![false; self.entities.len()];
        for (name, tables) in &self.groups {
            let idx: Vec<usize> = tables
                .iter()
                .filter_map(|t| find(&self.entities, t))
                .filter(|&i| !std::mem::replace(&mut placed[i], true))
                .collect();
            if !idx.is_empty() {
                blocks.push((Some(name.clone()), idx));
            }
        }
        let rest: Vec<usize> = (0..self.entities.len()).filter(|&i| !placed[i]).collect();
        if !rest.is_empty() {
            blocks.push((None, rest));
        }
        let mut sections = vec![];
        let mut x0 = 0.0;
        for (name, idx) in blocks {
            let mut part: Vec<Entity> = idx.iter().map(|&i| self.entities[i].clone()).collect();
            layout(&mut part, &relations);
            let (inset_x, inset_y) = if name.is_some() {
                (PAD, TITLE)
            } else {
                (0.0, 0.0)
            };
            let mut right: f64 = 0.0;
            let mut bottom: f64 = 0.0;
            for (k, &i) in idx.iter().enumerate() {
                let e = &mut self.entities[i];
                e.x = x0 + inset_x + part[k].x;
                e.y = inset_y + part[k].y;
                right = right.max(e.x + ENTITY_W);
                bottom = bottom.max(e.y + entity_height(e));
            }
            if let Some(title) = name {
                sections.push(EerSection {
                    id: uid(),
                    title,
                    x: x0,
                    y: 0.0,
                    w: right + PAD - x0,
                    h: bottom + PAD,
                    color: None,
                    tint: None,
                });
                right += PAD;
            }
            x0 = right + 100.0;
        }
        SqlImport {
            entities: self.entities,
            relations,
            sections,
            skipped: self.skipped,
        }
    }
}

// The same sizes as the EER editor (src/lib/eer.ts)
const ENTITY_W: f64 = 280.0;
fn entity_height(e: &Entity) -> f64 {
    38.0 + e.attributes.len().max(1) as f64 * 26.0 + 6.0
}

/// The key of a setting: the words before its `:` (`not null`, `default`, `ref`)
fn item_key(item: &[Tok]) -> String {
    item.iter()
        .take_while(|t| **t != Tok::Sym(':'))
        .filter_map(|t| {
            if let Tok::Word(w) = t {
                Some(w.to_lowercase())
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// The value of a setting: what comes after its `:`
fn item_value(item: &[Tok]) -> String {
    let mut s = String::new();
    for t in item.iter().skip_while(|t| **t != Tok::Sym(':')).skip(1) {
        match t {
            Tok::Word(w) | Tok::Str(w) | Tok::Expr(w) => {
                if !s.is_empty() && !s.ends_with('.') && !s.ends_with('-') {
                    s.push(' ');
                }
                s.push_str(w);
            }
            Tok::Sym(c) => s.push(*c),
            _ => {}
        }
    }
    s.trim().to_string()
}

fn ref_action(s: &str) -> RefAction {
    match s.to_lowercase().as_str() {
        "cascade" => RefAction::Cascade,
        "restrict" => RefAction::Restrict,
        "set null" => RefAction::SetNull,
        "set default" => RefAction::SetDefault,
        _ => RefAction::NoAction,
    }
}

// ===========================================================================
// Writing
// ===========================================================================

/// A name as DBML needs it: as it is when plain, else in double quotes
fn q(name: &str) -> String {
    let plain = name
        .chars()
        .next()
        .is_some_and(|c| c.is_alphabetic() || c == '_')
        && name.chars().all(|c| c.is_alphanumeric() || c == '_');
    if plain {
        name.to_string()
    } else {
        format!("\"{}\"", name.replace('"', "\\\""))
    }
}

fn string(s: &str) -> String {
    if s.contains('\n') {
        format!("'''{}'''", s.replace("'''", "\\'''"))
    } else {
        format!("'{}'", s.replace('\\', "\\\\").replace('\'', "\\'"))
    }
}

fn type_name(a: &Attribute) -> String {
    use DataType as T;
    match a.data_type {
        T::SmallInt => "smallint".into(),
        T::Int => "int".into(),
        T::BigInt => "bigint".into(),
        T::Decimal => format!(
            "decimal({},{})",
            a.length.unwrap_or(10),
            a.scale.unwrap_or(2)
        ),
        T::Float => "float".into(),
        T::Boolean => "boolean".into(),
        T::Char => format!("char({})", a.length.unwrap_or(1)),
        T::Varchar => format!("varchar({})", a.length.unwrap_or(255)),
        T::Text => "text".into(),
        T::Date => "date".into(),
        T::Time => "time".into(),
        T::DateTime => "datetime".into(),
        T::Timestamp => "timestamptz".into(),
        T::Uuid => "uuid".into(),
        T::Json => "json".into(),
        T::Blob => "blob".into(),
    }
}

/// A default as DBML writes it: numbers and true/false/null as they are,
/// expressions (`CURRENT_TIMESTAMP`, `now()`) in backticks, text quoted
fn default(v: &str) -> String {
    let v = v.trim();
    let lower = v.to_lowercase();
    if v.parse::<f64>().is_ok() || matches!(lower.as_str(), "true" | "false" | "null") {
        v.to_string()
    } else if v.starts_with('\'') && v.ends_with('\'') && v.len() >= 2 {
        string(&v[1..v.len() - 1])
    } else if v.contains('(')
        || (v.chars().all(|c| c.is_ascii_uppercase() || c == '_') && v.len() > 2)
    {
        format!("`{v}`")
    } else {
        string(v)
    }
}

/// The diagram as DBML: its tables, relations and sections (as table groups).
pub fn to_dbml(doc: &EerDoc) -> String {
    let mut out = String::from("// Generated by Flow\n");
    let by_id: HashMap<&str, &Entity> = doc.entities.iter().map(|e| (e.id.as_str(), e)).collect();
    let attr = |e: &Entity, id: &str| {
        e.attributes
            .iter()
            .find(|a| a.id == id)
            .map(|a| a.name.clone())
    };

    for e in &doc.entities {
        out.push_str(&format!("\nTable {} {{\n", q(&e.name)));
        for a in &e.attributes {
            let mut s = vec![];
            if a.primary_key {
                s.push("pk".to_string());
            }
            if a.auto_increment {
                s.push("increment".into());
            }
            if !a.nullable && !a.primary_key {
                s.push("not null".into());
            }
            if a.unique && !a.primary_key {
                s.push("unique".into());
            }
            if let Some(d) = a.default_value.as_deref().filter(|d| !d.trim().is_empty()) {
                s.push(format!("default: {}", default(d)));
            }
            let settings = if s.is_empty() {
                String::new()
            } else {
                format!(" [{}]", s.join(", "))
            };
            out.push_str(&format!("  {} {}{settings}\n", q(&a.name), type_name(a)));
        }
        let indexes: Vec<String> = e
            .indexes
            .iter()
            .filter_map(|ix| {
                let cols: Vec<String> = ix
                    .columns
                    .iter()
                    .filter_map(|id| attr(e, id))
                    .map(|n| q(&n))
                    .collect();
                if cols.is_empty() {
                    return None;
                }
                let mut s = vec![];
                if ix.unique {
                    s.push("unique".to_string());
                }
                if !ix.name.trim().is_empty() {
                    s.push(format!("name: {}", string(ix.name.trim())));
                }
                let cols = if cols.len() == 1 {
                    cols[0].clone()
                } else {
                    format!("({})", cols.join(", "))
                };
                Some(if s.is_empty() {
                    format!("    {cols}\n")
                } else {
                    format!("    {cols} [{}]\n", s.join(", "))
                })
            })
            .collect();
        if !indexes.is_empty() {
            out.push_str(&format!("\n  indexes {{\n{}  }}\n", indexes.concat()));
        }
        if let Some(c) = e.comment.as_deref().filter(|c| !c.trim().is_empty()) {
            out.push_str(&format!("\n  Note: {}\n", string(c)));
        }
        out.push_str("}\n");
    }

    let refs: Vec<String> = doc
        .relations
        .iter()
        .filter_map(|r| {
            let (a, b) = (by_id.get(r.from.as_str())?, by_id.get(r.to.as_str())?);
            let many = (r.from_cardinality.is_many(), r.to_cardinality.is_many());
            let (ca, cb): (Vec<String>, Vec<String>) =
                if many == (true, true) || r.columns.is_empty() {
                    // DBML names columns on both sides: the primary keys
                    let pk = |e: &Entity| {
                        e.attributes
                            .iter()
                            .find(|x| x.primary_key)
                            .or(e.attributes.first())
                            .map(|x| x.name.clone())
                    };
                    (vec![pk(a)?], vec![pk(b)?])
                } else {
                    r.columns
                        .iter()
                        .filter_map(|c| Some((attr(a, &c.from)?, attr(b, &c.to)?)))
                        .unzip()
                };
            let side = |e: &Entity, cols: &[String]| {
                let cols: Vec<String> = cols.iter().map(|c| q(c)).collect();
                if cols.len() == 1 {
                    format!("{}.{}", q(&e.name), cols[0])
                } else {
                    format!("{}.({})", q(&e.name), cols.join(", "))
                }
            };
            let op = match many {
                (true, true) => "<>",
                (false, false) => "-",
                _ => ">",
            };
            let mut s = vec![];
            if r.on_delete != RefAction::NoAction {
                s.push(format!("delete: {}", action_name(r.on_delete)));
            }
            if r.on_update != RefAction::NoAction {
                s.push(format!("update: {}", action_name(r.on_update)));
            }
            let settings = if s.is_empty() {
                String::new()
            } else {
                format!(" [{}]", s.join(", "))
            };
            let name = r
                .label
                .as_deref()
                .filter(|l| !l.trim().is_empty())
                .map(|l| format!(" {}", q(l.trim())))
                .unwrap_or_default();
            Some(format!(
                "Ref{name}: {} {op} {}{settings}\n",
                side(a, &ca),
                side(b, &cb)
            ))
        })
        .collect();
    if !refs.is_empty() {
        out.push('\n');
        out.push_str(&refs.concat());
    }

    // Sections: the tables whose middle is in them (in the smallest one, when nested)
    let mut groups: BTreeMap<usize, Vec<&str>> = BTreeMap::new();
    for e in &doc.entities {
        let (cx, cy) = (e.x + ENTITY_W / 2.0, e.y + entity_height(e) / 2.0);
        let home = doc
            .sections
            .iter()
            .enumerate()
            .filter(|(_, s)| cx >= s.x && cx <= s.x + s.w && cy >= s.y && cy <= s.y + s.h)
            .min_by(|a, b| (a.1.w * a.1.h).total_cmp(&(b.1.w * b.1.h)));
        if let Some((i, _)) = home {
            groups.entry(i).or_default().push(&e.name);
        }
    }
    for (i, tables) in groups {
        let s = &doc.sections[i];
        let title = if s.title.trim().is_empty() {
            format!("group_{}", i + 1)
        } else {
            s.title.trim().to_string()
        };
        let list: Vec<String> = tables.iter().map(|t| format!("  {}\n", q(t))).collect();
        out.push_str(&format!(
            "\nTableGroup {} {{\n{}}}\n",
            q(&title),
            list.concat()
        ));
    }
    out
}

fn action_name(a: RefAction) -> &'static str {
    match a {
        RefAction::NoAction => "no action",
        RefAction::Restrict => "restrict",
        RefAction::Cascade => "cascade",
        RefAction::SetNull => "set null",
        RefAction::SetDefault => "set default",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::eer::tests::shop;

    #[test]
    fn reads_dbml() {
        let src = r#"
            Project shop { database_type: 'PostgreSQL' }
            // People who buy
            Table users as U {
              id integer [pk, increment]
              email varchar(255) [not null, unique, note: 'login']
              status user_status [default: 'active']
              created_at timestamp [default: `now()`]
              score decimal(5, 2) [default: 0.5]
              Note: 'Who buys'
            }
            Table orders {
              id int [pk]
              user_id int [ref: > users.id, not null]
              placed date
              indexes {
                (user_id, placed) [name: 'by_user']
                placed
              }
            }
            Table tags { id int [pk] }
            Ref order_tags: orders.id <> tags.id
            Ref: orders.user_id > users.id [delete: cascade]
            Enum user_status { active
              blocked }
            TableGroup sales { users orders }
            Note sticky { 'not drawn' }
        "#;
        let got = read_dbml(src);
        let names: Vec<&str> = got.entities.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["users", "orders", "tags"]);
        let users = &got.entities[0];
        assert_eq!(users.comment.as_deref(), Some("Who buys"));
        let a = |n: &str| users.attributes.iter().find(|a| a.name == n).unwrap();
        assert!(a("id").primary_key && a("id").auto_increment && !a("id").nullable);
        assert!(a("email").unique && !a("email").nullable && a("email").length == Some(255));
        assert_eq!(a("status").default_value.as_deref(), Some("active"));
        assert_eq!(a("created_at").default_value.as_deref(), Some("now()"));
        assert_eq!(a("score").default_value.as_deref(), Some("0.5"));
        assert_eq!((a("score").length, a("score").scale), (Some(5), Some(2)));
        let orders = &got.entities[1];
        assert_eq!(orders.indexes.len(), 2);
        assert_eq!(
            (
                orders.indexes[0].name.as_str(),
                orders.indexes[0].columns.len()
            ),
            ("by_user", 2)
        );
        // The inline ref and the Ref of the same columns: two relations; the m:n one without columns
        assert_eq!(
            got.relations
                .iter()
                .filter(|r| r.from == orders.id && r.to == users.id)
                .count(),
            2
        );
        assert!(
            got.relations
                .iter()
                .any(|r| r.on_delete == RefAction::Cascade)
        );
        let m2m = got
            .relations
            .iter()
            .find(|r| r.from_cardinality.is_many() && r.to_cardinality.is_many())
            .unwrap();
        assert!(m2m.columns.is_empty() && m2m.label.as_deref() == Some("order_tags"));
        // The group is a section around its tables; tags is beside it
        assert_eq!(got.sections.len(), 1);
        let s = &got.sections[0];
        assert_eq!(s.title, "sales");
        for e in &got.entities[..2] {
            assert!(
                e.x >= s.x
                    && e.x + ENTITY_W <= s.x + s.w
                    && e.y >= s.y
                    && e.y + entity_height(e) <= s.y + s.h,
                "{} in the section",
                e.name
            );
        }
        assert!(got.entities[2].x > s.x + s.w);
        assert!(
            got.skipped.iter().any(|m| m.contains("enum")),
            "{:?}",
            got.skipped
        );
        assert!(
            got.skipped
                .iter()
                .any(|m| m.to_lowercase().contains("note")),
            "{:?}",
            got.skipped
        );
    }

    /// Written and read back: the same tables, columns, keys, defaults, indexes and relations.
    #[test]
    fn round_trip() {
        let mut doc = shop();
        doc.sections.push(EerSection {
            id: "s".into(),
            title: "Sales area".into(),
            x: -50.0,
            y: -50.0,
            w: 400.0,
            h: 500.0,
            color: None,
            tint: None,
        });
        let dbml = to_dbml(&doc);
        let got = read_dbml(&dbml);
        assert!(got.skipped.is_empty(), "{:?}\n{dbml}", got.skipped);
        assert_eq!(got.entities.len(), doc.entities.len(), "{dbml}");
        for (want, have) in doc.entities.iter().zip(&got.entities) {
            assert_eq!(want.name, have.name);
            assert_eq!(want.comment, have.comment, "{}", want.name);
            assert_eq!(
                want.indexes.len(),
                have.indexes.len(),
                "{}\n{dbml}",
                want.name
            );
            for (a, b) in want.attributes.iter().zip(&have.attributes) {
                let ctx = format!("{}.{}\n{dbml}", want.name, a.name);
                assert_eq!(
                    (
                        &a.name,
                        a.data_type,
                        a.primary_key,
                        a.unique,
                        a.auto_increment
                    ),
                    (
                        &b.name,
                        b.data_type,
                        b.primary_key,
                        b.unique,
                        b.auto_increment
                    ),
                    "{ctx}"
                );
                assert_eq!(
                    a.nullable || a.primary_key,
                    b.nullable || b.primary_key,
                    "{ctx}"
                );
                assert_eq!(a.default_value, b.default_value, "{ctx}");
            }
        }
        assert_eq!(got.relations.len(), doc.relations.len(), "{dbml}");
        assert!(
            got.relations
                .iter()
                .any(|r| r.on_delete == RefAction::Cascade),
            "{dbml}"
        );
        assert_eq!(got.sections.len(), 1, "{dbml}");
        assert_eq!(got.sections[0].title, "Sales area");
    }
}
