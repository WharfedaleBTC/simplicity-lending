//! SimplicityHL value literals, for argument and witness JSON (`{"NAME": "<literal>"}`), as the
//! SimplicityHL CLI and the web app write them.

use either::Either;

/// A value written as a SimplicityHL literal of its declared type.
pub trait HlValue {
    fn hl(&self) -> String;
}

macro_rules! decimal {
    ($($t:ty),*) => {$(
        impl HlValue for $t {
            fn hl(&self) -> String {
                self.to_string()
            }
        }
    )*};
}
decimal!(u8, u16, u32, u64, bool);

impl HlValue for () {
    fn hl(&self) -> String {
        "()".into()
    }
}

/// A `u256`, in the byte order the program sees (an `AssetId`'s inner bytes, not its display).
impl HlValue for [u8; 32] {
    fn hl(&self) -> String {
        format!("0x{}", hex::encode(self))
    }
}

impl<L: HlValue, R: HlValue> HlValue for Either<L, R> {
    fn hl(&self) -> String {
        match self {
            Either::Left(l) => format!("Left({})", l.hl()),
            Either::Right(r) => format!("Right({})", r.hl()),
        }
    }
}

impl<A: HlValue, B: HlValue> HlValue for (A, B) {
    fn hl(&self) -> String {
        format!("({}, {})", self.0.hl(), self.1.hl())
    }
}

impl<A: HlValue, B: HlValue, C: HlValue, D: HlValue> HlValue for (A, B, C, D) {
    fn hl(&self) -> String {
        format!(
            "({}, {}, {}, {})",
            self.0.hl(),
            self.1.hl(),
            self.2.hl(),
            self.3.hl()
        )
    }
}

/// `{"NAME": "<literal>", …}`.
#[must_use]
pub fn values(entries: &[(&str, &dyn HlValue)]) -> serde_json::Map<String, serde_json::Value> {
    entries
        .iter()
        .map(|(k, v)| ((*k).to_string(), serde_json::Value::String(v.hl())))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn literals() {
        type Repayment = Either<Either<(u64, u64), u64>, u64>;
        let path: Either<Either<(), ()>, Repayment> =
            Either::Right(Either::Left(Either::Left((3, 4))));
        assert_eq!(path.hl(), "Right(Left(Left((3, 4))))");
        assert_eq!([0xab; 32].hl(), format!("0x{}", "ab".repeat(32)));
        assert_eq!(true.hl(), "true");
    }
}
