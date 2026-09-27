// Opt-in integration fixture: captures only its own window and never steals keyboard focus.
#include "video.hpp"
#include "pacing.hpp"
#include <cstdio>
#include <fcntl.h>
#include <io.h>
#include <thread>
#include <dwmapi.h>
#include <future>

namespace desktop {
namespace {
constexpr int width = 640, height = 360;
int phase = 0, tick = 0;

void fill(HDC dc, RECT rect, COLORREF color) {
    HBRUSH brush = CreateSolidBrush(color);
    FillRect(dc, &rect, brush);
    DeleteObject(brush);
}

LRESULT CALLBACK paint(HWND window, UINT message, WPARAM wparam, LPARAM lparam) {
    if (message != WM_PAINT) return DefWindowProc(window, message, wparam, lparam);
    PAINTSTRUCT state{};
    HDC dc = BeginPaint(window, &state);
    const bool moving = phase == 2;
    const int color = moving ? (tick * 17) % 220 : 40;
    fill(dc, {0, 0, width, height}, RGB(color, color, color));
    // Stable colored marker detects black/incorrect GPU conversion as well as real decoding.
    fill(dc, {10, 10, 50, 50}, RGB(220, 30, 20));
    if (phase == 1) fill(dc, {100, 100, 180, 140}, tick % 2 ? RGB(240, 240, 240) : RGB(5, 5, 5));
    if (phase == 4) fill(dc, {250, 180, 266, 196}, RGB(240, 240, 240));
    EndPaint(window, &state);
    return 0;
}

struct Window {
    HWND handle = nullptr;
    Window() {
        WNDCLASSW klass{};
        klass.lpfnWndProc = paint; klass.hInstance = GetModuleHandle(nullptr);
        klass.lpszClassName = L"CswDesktopDamageFixture";
        if (!RegisterClassW(&klass)) throw std::runtime_error("fixture registration failed");
        handle = CreateWindowExW(0, klass.lpszClassName, L"Desktop video test",
            WS_POPUP, 50, 50, width, height, nullptr, nullptr, klass.hInstance, nullptr);
        if (!handle) throw std::runtime_error("fixture creation failed");
        ShowWindow(handle, SW_SHOWNOACTIVATE);
        // The runner hides the console through STARTUPINFO; explicitly show only this fixture window.
        SetWindowPos(handle, nullptr, 0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW);
        UpdateWindow(handle);
        MSG message{};
        while (PeekMessage(&message, nullptr, 0, 0, PM_REMOVE)) DispatchMessage(&message);
        DwmFlush();
    }
    ~Window() { if (handle) DestroyWindow(handle); }
};

void update(double seconds, HWND window) {
    const int next_phase = std::min(5, static_cast<int>(seconds / 3));
    const int next_tick = static_cast<int>(seconds * (next_phase == 1 ? 5 : 30));
    if (phase != next_phase) {
        phase = next_phase;
        std::fprintf(stderr, "phase=%d\n", phase);
    } else if ((phase != 1 && phase != 2) || tick == next_tick) return;
    tick = next_tick;
    InvalidateRect(window, nullptr, FALSE);
    UpdateWindow(window);
}

void run(bool gdi, bool baseline) {
    std::promise<HWND> ready;
    auto handle = ready.get_future();
    std::jthread ui([&](std::stop_token stopped) {
        try {
            Window window;
            ready.set_value(window.handle);
            const auto start = Clock::now();
            while (!stopped.stop_requested()) {
                MSG message{};
                while (PeekMessage(&message, nullptr, 0, 0, PM_REMOVE)) DispatchMessage(&message);
                update(std::chrono::duration<double>(Clock::now() - start).count(), window.handle);
                std::this_thread::sleep_for(std::chrono::milliseconds(5));
            }
        } catch (...) { ready.set_exception(std::current_exception()); }
    });
    Config config{width, height, 60, 3'000'000, nullptr, gdi, handle.get()};
    Encoder encoder(config);
    std::unique_ptr<Capture> capture;
    std::unique_ptr<GdiCapture> software;
    if (gdi) { software = std::make_unique<GdiCapture>(config); software->open(); }
    else capture = std::make_unique<Capture>(encoder.gpu(), config);
    DamageGate gate(config.fps);
    FrameWait wait;
    const auto start = Clock::now();
    std::fprintf(stderr, "phase=0\n");
    while (Clock::now() - start < std::chrono::seconds(18)) {
        const bool captured = gdi ? software->poll(gate) : capture->poll(gate);
        if (baseline) gate.observe(true);
        const auto now = Clock::now();
        if (captured && gate.due(now)) {
            if (gdi) encoder.submit(*software);
            else encoder.submit(capture->texture().get());
            gate.submitted(now);
        }
        encoder.receive();
        wait.until(Clock::now() + std::chrono::milliseconds(gdi ? 16 : 1));
    }
}
}
}

int main(int argc, char** argv) {
    try {
        _setmode(_fileno(stdout), _O_BINARY);
        SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        winrt::init_apartment(winrt::apartment_type::multi_threaded);
        av_log_set_level(AV_LOG_ERROR);
        desktop::run(argc > 1 && std::strcmp(argv[1], "gdi") == 0,
            argc > 2 && std::strcmp(argv[2], "baseline") == 0);
        return 0;
    } catch (const winrt::hresult_error& error) {
        std::fprintf(stderr, "fixture Windows error=%08lx\n", static_cast<unsigned long>(error.code().value));
    } catch (const std::exception& error) { std::fprintf(stderr, "fixture: %s\n", error.what()); }
    return 1;
}
