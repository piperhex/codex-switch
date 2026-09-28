#include "video.hpp"

namespace desktop {
GdiCapture::GdiCapture(const Config& config)
    : width(config.width), height(config.height), window(config.window), monitor(config.monitor) {}

void GdiCapture::open() {
    screen = GetDC(window);
    if (!screen) throw std::runtime_error("desktop unavailable");
    memory = CreateCompatibleDC(screen);
    BITMAPINFO info{};
    info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    info.bmiHeader.biWidth = width;
    info.bmiHeader.biHeight = -height;
    info.bmiHeader.biPlanes = 1;
    info.bmiHeader.biBitCount = 32;
    info.bmiHeader.biCompression = BI_RGB;
    void* data = nullptr;
    bitmap = CreateDIBSection(screen, &info, DIB_RGB_COLORS, &data, nullptr, 0);
    if (!memory || !bitmap || !data) throw std::runtime_error("desktop allocation failed");
    pixels = static_cast<uint8_t*>(data);
    previous_object = SelectObject(memory, bitmap);
}

GdiCapture::~GdiCapture() {
    if (previous_object) SelectObject(memory, previous_object);
    if (bitmap) DeleteObject(bitmap);
    if (memory) DeleteDC(memory);
    if (screen) ReleaseDC(window, screen);
}

bool GdiCapture::poll(DamageGate& gate) {
    MONITORINFO info{};
    info.cbSize = sizeof(info);
    RECT source{};
    if (window) {
        if (!GetClientRect(window, &source)) throw std::runtime_error("fixture closed");
    } else {
        if (!GetMonitorInfoW(monitor, &info)) throw std::runtime_error("display disconnected");
        source = info.rcMonitor;
    }
    const int source_width = source.right - source.left, source_height = source.bottom - source.top;
    if (source_width <= 0 || source_height <= 0) throw std::runtime_error("desktop unavailable");
    SetStretchBltMode(memory, HALFTONE);
    if (!StretchBlt(memory, 0, 0, width, height, screen, source.left, source.top,
        source_width, source_height, SRCCOPY | CAPTUREBLT))
        throw std::runtime_error("desktop copy failed");
    GdiFlush();
    const std::span<const uint8_t> current(pixels, static_cast<size_t>(width) * height * 4);
    const auto damage = changed_rows(previous, current, width, height);
    gate.observe(!damage.empty());
    previous.assign(current.begin(), current.end());
    return true;
}
}
