//! Windows aspect-ratio lock via WM_SIZING window subclass.
//!
//! Why native: JS can only correct size *after* the OS paints the dragged
//! window, so it always lands a frame late and snaps (flicker). WM_SIZING lets
//! us constrain the proposed drag RECT *before* paint — locked every frame.

use std::sync::atomic::{AtomicU64, Ordering};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    WM_SIZING, WMSZ_BOTTOM, WMSZ_LEFT, WMSZ_RIGHT, WMSZ_TOP, WMSZ_TOPLEFT, WMSZ_TOPRIGHT,
};

// Current video aspect (width / height) as f64 bits. 0 = unlocked.
static ASPECT: AtomicU64 = AtomicU64::new(0);

const SUBCLASS_ID: usize = 1;

pub fn set_aspect(ratio: f64) {
    let bits = if ratio > 0.0 { ratio.to_bits() } else { 0 };
    ASPECT.store(bits, Ordering::Relaxed);
}

pub fn install(hwnd_raw: isize) {
    let hwnd = HWND(hwnd_raw as _);
    unsafe {
        let _ = SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, 0);
    }
}

unsafe extern "system" fn subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _ref_data: usize,
) -> LRESULT {
    if msg == WM_SIZING {
        let ratio = f64::from_bits(ASPECT.load(Ordering::Relaxed));
        if ratio > 0.0 && lparam.0 != 0 {
            let rect = &mut *(lparam.0 as *mut RECT);
            let width = (rect.right - rect.left) as f64;
            let height = (rect.bottom - rect.top) as f64;
            match wparam.0 as u32 {
                // Side edges: width is driven → derive height (anchor top).
                WMSZ_LEFT | WMSZ_RIGHT => {
                    rect.bottom = rect.top + (width / ratio).round() as i32;
                }
                // Top/bottom edges: height is driven → derive width (anchor left).
                WMSZ_TOP | WMSZ_BOTTOM => {
                    rect.right = rect.left + (height * ratio).round() as i32;
                }
                // Top corners: width drives height, anchor bottom edge.
                WMSZ_TOPLEFT | WMSZ_TOPRIGHT => {
                    rect.top = rect.bottom - (width / ratio).round() as i32;
                }
                // Bottom corners (+ fallback): width drives height, anchor top edge.
                _ => {
                    rect.bottom = rect.top + (width / ratio).round() as i32;
                }
            }
        }
        return LRESULT(1);
    }
    DefSubclassProc(hwnd, msg, wparam, lparam)
}
