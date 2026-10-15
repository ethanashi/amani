//! Independently authored, MIT-licensed Option membership helper.
//! dirs-sys only needs this API on XDG platforms; macOS does not call it.
#![no_std]
pub trait OptionExt<T> {
    fn contains<U>(&self, candidate: &U) -> bool where U: PartialEq<T>;
}
impl<T> OptionExt<T> for Option<T> {
    fn contains<U>(&self, candidate: &U) -> bool where U: PartialEq<T> {
        self.as_ref().is_some_and(|value| candidate == value)
    }
}
#[cfg(test)]
mod tests {
    use super::OptionExt;
    #[test]
    fn membership_requires_present_equal_value() {
        assert!(Some(4).contains(&4));
        assert!(!Some(4).contains(&5));
        assert!(!Option::<i32>::None.contains(&4));
    }
}
