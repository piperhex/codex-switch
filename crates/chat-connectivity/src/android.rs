use jni::{
    objects::{JClass, JString},
    sys::jstring,
    JNIEnv,
};

#[no_mangle]
pub extern "system" fn Java_com_codexswitch_connectivity_NativeConnectivity_call(
    mut env: JNIEnv,
    _class: JClass,
    request: JString,
) -> jstring {
    let reply = match env.get_string(&request) {
        Ok(value) => crate::ffi::call(value.to_string_lossy().as_ref()),
        Err(_) => "{\"error\":\"Invalid request\"}".into(),
    };
    env.new_string(reply)
        .map(JString::into_raw)
        .unwrap_or(std::ptr::null_mut())
}
