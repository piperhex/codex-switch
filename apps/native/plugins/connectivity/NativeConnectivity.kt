package com.codexswitch.connectivity

object NativeConnectivity {
    init { System.loadLibrary("csw_chat_connectivity") }
    @JvmStatic external fun call(request: String): String
}
