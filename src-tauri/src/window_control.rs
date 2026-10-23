use crate::config::{ViewMode, WindowBounds};
use tauri::{
    LogicalSize, PhysicalPosition, PhysicalSize, Runtime, WebviewWindow, Window, window::Monitor,
};

#[derive(Clone, Copy, Debug, PartialEq)]
struct ModeDimensions {
    width: f64,
    height: f64,
    min_width: f64,
    min_height: f64,
}

fn dimensions(mode: ViewMode) -> ModeDimensions {
    match mode {
        ViewMode::Phone => ModeDimensions {
            width: 460.0,
            height: 860.0,
            min_width: 360.0,
            min_height: 600.0,
        },
        ViewMode::Tablet => ModeDimensions {
            width: 1360.0,
            height: 900.0,
            min_width: 720.0,
            min_height: 500.0,
        },
    }
}

pub(crate) trait WindowGeometry {
    fn outer_position(&self) -> tauri::Result<PhysicalPosition<i32>>;
    fn inner_size(&self) -> tauri::Result<PhysicalSize<u32>>;
}

impl<R: Runtime> WindowGeometry for Window<R> {
    fn outer_position(&self) -> tauri::Result<PhysicalPosition<i32>> {
        Window::outer_position(self)
    }
    fn inner_size(&self) -> tauri::Result<PhysicalSize<u32>> {
        Window::inner_size(self)
    }
}

impl<R: Runtime> WindowGeometry for WebviewWindow<R> {
    fn outer_position(&self) -> tauri::Result<PhysicalPosition<i32>> {
        WebviewWindow::outer_position(self)
    }
    fn inner_size(&self) -> tauri::Result<PhysicalSize<u32>> {
        WebviewWindow::inner_size(self)
    }
}

pub fn bounds_from_window(window: &impl WindowGeometry) -> Result<WindowBounds, String> {
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.inner_size().map_err(|error| error.to_string())?;
    Ok(WindowBounds {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

fn monitor_for_bounds<R: Runtime>(
    window: &WebviewWindow<R>,
    bounds: Option<WindowBounds>,
) -> Option<Monitor> {
    if let Some(bounds) = bounds {
        let center_x = i64::from(bounds.x) + i64::from(bounds.width) / 2;
        let center_y = i64::from(bounds.y) + i64::from(bounds.height) / 2;
        if let Ok(monitors) = window.available_monitors() {
            if let Some(monitor) = monitors.into_iter().find(|monitor| {
                let area = monitor.work_area();
                let left = i64::from(area.position.x);
                let top = i64::from(area.position.y);
                center_x >= left
                    && center_x < left + i64::from(area.size.width)
                    && center_y >= top
                    && center_y < top + i64::from(area.size.height)
            }) {
                return Some(monitor);
            }
        }
    }
    window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())
}

pub fn clamp_bounds(
    bounds: WindowBounds,
    area: WindowBounds,
    min_width: u32,
    min_height: u32,
) -> WindowBounds {
    let width = bounds.width.max(min_width).min(area.width.max(1));
    let height = bounds.height.max(min_height).min(area.height.max(1));
    let min_x = i64::from(area.x);
    let min_y = i64::from(area.y);
    let max_x = min_x + i64::from(area.width.saturating_sub(width));
    let max_y = min_y + i64::from(area.height.saturating_sub(height));
    WindowBounds {
        x: i64::from(bounds.x).clamp(min_x, max_x) as i32,
        y: i64::from(bounds.y).clamp(min_y, max_y) as i32,
        width,
        height,
    }
}

fn work_area_bounds(monitor: &Monitor) -> WindowBounds {
    let area = monitor.work_area();
    WindowBounds {
        x: area.position.x,
        y: area.position.y,
        width: area.size.width,
        height: area.size.height,
    }
}

pub fn apply_mode(
    window: &WebviewWindow,
    mode: ViewMode,
    saved_bounds: Option<WindowBounds>,
    restore_saved_size: bool,
) -> Result<(), String> {
    let dimensions = dimensions(mode);
    let scale = window
        .scale_factor()
        .map_err(|error| error.to_string())?
        .max(0.5);
    let monitor = monitor_for_bounds(window, saved_bounds);

    let (target, minimum, position) = if let Some(monitor) = monitor {
        let area = work_area_bounds(&monitor);
        let max_width = area.width.max(1);
        let max_height = area.height.max(1);
        let minimum = PhysicalSize::new(
            ((dimensions.min_width * scale).round() as u32).min(max_width),
            ((dimensions.min_height * scale).round() as u32).min(max_height),
        );
        let default_bounds = WindowBounds {
            x: area.x,
            y: area.y,
            width: (dimensions.width * scale).round() as u32,
            height: (dimensions.height * scale).round() as u32,
        };
        let desired_size = if restore_saved_size {
            saved_bounds.unwrap_or(default_bounds)
        } else {
            default_bounds
        };
        let size = PhysicalSize::new(
            desired_size.width.max(minimum.width).min(max_width),
            desired_size.height.max(minimum.height).min(max_height),
        );
        let positioned = if saved_bounds.is_some() {
            saved_bounds.unwrap()
        } else {
            WindowBounds {
                x: area.x + (area.width.saturating_sub(size.width) / 2) as i32,
                y: area.y + (area.height.saturating_sub(size.height) / 2) as i32,
                width: size.width,
                height: size.height,
            }
        };
        let clamped = clamp_bounds(
            WindowBounds {
                width: size.width,
                height: size.height,
                ..positioned
            },
            area,
            minimum.width,
            minimum.height,
        );
        (
            size,
            minimum,
            Some(PhysicalPosition::new(clamped.x, clamped.y)),
        )
    } else {
        let minimum = PhysicalSize::new(
            (dimensions.min_width * scale).round() as u32,
            (dimensions.min_height * scale).round() as u32,
        );
        let default_size = || {
            PhysicalSize::new(
                (dimensions.width * scale).round() as u32,
                (dimensions.height * scale).round() as u32,
            )
        };
        let size = if restore_saved_size {
            saved_bounds
                .map(|bounds| {
                    PhysicalSize::new(
                        bounds.width.max(minimum.width),
                        bounds.height.max(minimum.height),
                    )
                })
                .unwrap_or_else(default_size)
        } else {
            default_size()
        };
        (
            size,
            minimum,
            saved_bounds.map(|bounds| PhysicalPosition::new(bounds.x, bounds.y)),
        )
    };

    window
        .set_min_size(Some(LogicalSize::new(
            minimum.width as f64 / scale,
            minimum.height as f64 / scale,
        )))
        .map_err(|error| error.to_string())?;
    window.set_size(target).map_err(|error| error.to_string())?;
    if let Some(position) = position {
        window
            .set_position(position)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phone_and_tablet_have_distinct_native_sizes_and_minimums() {
        let phone = dimensions(ViewMode::Phone);
        let tablet = dimensions(ViewMode::Tablet);
        assert!(phone.width < tablet.width);
        assert!(phone.height > phone.width);
        assert!(tablet.width > tablet.height);
        assert_eq!((phone.min_width, phone.min_height), (360.0, 600.0));
        assert_eq!((tablet.min_width, tablet.min_height), (720.0, 500.0));
        assert_eq!((tablet.width, tablet.height), (1360.0, 900.0));
    }

    #[test]
    fn restored_window_size_and_position_fit_monitor_work_area() {
        let area = WindowBounds {
            x: -1920,
            y: 0,
            width: 1920,
            height: 1040,
        };
        let saved = WindowBounds {
            x: 500,
            y: -300,
            width: 2400,
            height: 1300,
        };
        assert_eq!(
            clamp_bounds(saved, area, 720, 500),
            WindowBounds {
                x: -1920,
                y: 0,
                width: 1920,
                height: 1040
            }
        );
    }

    #[test]
    fn minimum_size_is_reduced_when_work_area_is_smaller() {
        let area = WindowBounds {
            x: 0,
            y: 0,
            width: 500,
            height: 400,
        };
        let saved = WindowBounds {
            x: -50,
            y: -50,
            width: 100,
            height: 100,
        };
        assert_eq!(
            clamp_bounds(saved, area, 720, 500),
            WindowBounds {
                x: 0,
                y: 0,
                width: 500,
                height: 400
            }
        );
    }
}
