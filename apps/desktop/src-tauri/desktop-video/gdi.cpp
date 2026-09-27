#include "video.hpp"

namespace desktop {
GdiCapture::GdiCapture(const Config& config) : width(config.width), height(config.height), window(config.window) {}

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
    RECT source{0, 0, GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN)};
    if (window && !GetClientRect(window, &source)) throw std::runtime_error("fixture closed");
    const int source_width = source.right, source_height = source.bottom;
    if (source_width <= 0 || source_height <= 0) throw std::runtime_error("desktop unavailable");
    SetStretchBltMode(memory, HALFTONE);
    if (!StretchBlt(memory, 0, 0, width, height, screen, 0, 0, source_width, source_height, SRCCOPY | CAPTUREBLT))
        throw std::runtime_error("desktop copy failed");
    GdiFlush();
    const std::span<const uint8_t> current(pixels, static_cast<size_t>(width) * height * 4);
    const auto damage = changed_rows(previous, current, width, height);
    gate.observe(!damage.empty());
    previous.assign(current.begin(), current.end());
    return true;
}
}
