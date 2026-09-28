#pragma once
#include <windows.h>
#include <chrono>
#include <string>

namespace desktop {
// The service worker runs in the console session as SYSTEM. This handle belongs to the capture process.
class DesktopContext {
    HDESK handle = nullptr;
    std::wstring name;
    std::chrono::steady_clock::time_point checked{};
public:
    DesktopContext();
    ~DesktopContext();
    void check();
};
void bind_service_desktop();
void check_service_desktop();
}
