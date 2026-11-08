//! `rune_notify::on_click`: the handler runs on whichever thread the system reports a click on
//! (a toast's activation, the notification center's delegate), so it reaches JavaScript through a
//! threadsafe function. ts/notify-click.ts turns what it receives back into a `Click`.

use napi::bindgen_prelude::Function;
use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use napi_derive::napi;

/// Calls `f([id, key, value, key, value, ...])` on JavaScript's thread for each click on a
/// notification this app posted.
#[napi(js_name = "__notify_on_click", ts_args_type = "f: (click: string[]) => void")]
pub fn on_click(f: Function<'_, Vec<String>, ()>) -> napi::Result<()> {
    let tsfn = f.build_threadsafe_function::<Vec<String>>().callee_handled::<false>().weak::<true>().build()?;
    rune_notify::on_click(move |click: rune_notify::Click| {
        let mut flat = vec![click.id];
        for (k, v) in click.info {
            flat.push(k);
            flat.push(v);
        }
        let _ = tsfn.call(flat, ThreadsafeFunctionCallMode::NonBlocking);
    });
    Ok(())
}
