#include "desktop_context.hpp"
#include <array>
#include <memory>
#include <stdexcept>

namespace desktop {
namespace {
std::unique_ptr<DesktopContext> context;
std::wstring desktop_name(HDESK desktop) {
    std::array<wchar_t, 256> buffer{};
    DWORD needed = 0;
    if (!GetUserObjectInformationW(desktop, UOI_NAME, buffer.data(),
        static_cast<DWORD>(sizeof(buffer)), &needed)) throw std::runtime_error("desktop unavailable");
    return buffer.data();
}
}
DesktopContext::DesktopContext() {
    handle = OpenInputDesktop(0, FALSE, DESKTOP_READOBJECTS | DESKTOP_WRITEOBJECTS | DESKTOP_CREATEWINDOW);
    if (!handle) throw std::runtime_error("desktop unavailable");
    try {
        name = desktop_name(handle);
        if (!SetThreadDesktop(handle)) throw std::runtime_error("desktop unavailable");
    } catch (...) { CloseDesktop(handle); handle = nullptr; throw; }
}
DesktopContext::~DesktopContext() {
    // It stays bound for this process's entire lifetime; Windows also closes it when the process exits.
    if (handle) CloseDesktop(handle);
}
void DesktopContext::check() {
    const auto now = std::chrono::steady_clock::now();
    if (now - checked < std::chrono::milliseconds(250)) return;
    checked = now;
    const auto active = OpenInputDesktop(0, FALSE, DESKTOP_READOBJECTS);
    if (!active) throw std::runtime_error("desktop changed");
    std::wstring current;
    try { current = desktop_name(active); } catch (...) { CloseDesktop(active); throw; }
    CloseDesktop(active);
    if (current != name) throw std::runtime_error("desktop changed");
}
void bind_service_desktop() {
    wchar_t worker[2]{};
    if (GetEnvironmentVariableW(L"CSW_DESKTOP_SERVICE_WORKER", worker, 2) == 1 && worker[0] == L'1')
        context = std::make_unique<DesktopContext>();
}
void check_service_desktop() { if (context) context->check(); }
}
