use std::collections::VecDeque;
use std::io::{self, BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, Sender};
use std::thread;
use std::time::{Duration, Instant};

use crossterm::event::{self, Event, KeyCode, KeyEventKind};
use ratatui::{
    layout::{Constraint, Layout},
    style::{Color, Modifier, Style},
    widgets::{Block, Gauge, Paragraph, Wrap},
};

const TOTAL_STEPS: usize = 8;
const MAX_LINES: usize = 12;

fn collect_output<T: io::Read + Send + 'static>(input: T, sender: Sender<String>, kind: &'static str) {
    thread::spawn(move || {
        for line in BufReader::new(input).lines().map_while(Result::ok) {
            let clean = line.replace('\r', " ").chars().take(250).collect::<String>();
            if sender.send(if kind == "stdout" { clean } else { format!("ERROR|{clean}") }).is_err() {
                break;
            }
        }
    });
}

fn render(
    frame: &mut ratatui::Frame<'_>,
    lines: &VecDeque<String>,
    active: &str,
    completed: usize,
    finished: bool,
    succeeded: bool,
) {
    let chunks = Layout::vertical([
        Constraint::Length(3),
        Constraint::Length(3),
        Constraint::Min(7),
        Constraint::Length(3),
    ])
    .split(frame.area());
    let header = Paragraph::new("BLOSSOM  /  Music DNA setup  /  Ratatui")
        .style(Style::default().fg(Color::LightGreen).add_modifier(Modifier::BOLD))
        .block(Block::bordered().title(" Local installation "));
    frame.render_widget(header, chunks[0]);

    let percent = ((completed.min(TOTAL_STEPS) * 100) / TOTAL_STEPS) as u16;
    let gauge = Gauge::default()
        .block(Block::bordered().title(" Checks completed "))
        .gauge_style(Style::default().fg(if finished && !succeeded { Color::Red } else { Color::Green }))
        .percent(percent);
    frame.render_widget(gauge, chunks[1]);

    let output = lines.iter().map(String::as_str).collect::<Vec<_>>().join("\n");
    let log = Paragraph::new(output)
        .style(Style::default().fg(Color::White))
        .block(Block::bordered().title(" Verification log "))
        .wrap(Wrap { trim: true });
    frame.render_widget(log, chunks[2]);

    let status = if finished {
        if succeeded { "Ready. The installer will close shortly." }
        else { "Setup failed. Review the log above and retry." }
    } else {
        active
    };
    frame.render_widget(
        Paragraph::new(format!("{status}\nPress Esc or Q to cancel"))
            .style(Style::default().fg(Color::Yellow))
            .block(Block::bordered().title(" Status ")),
        chunks[3],
    );
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let mut child = Command::new("node")
        .arg("scripts/setup-blossom.mjs")
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let (sender, receiver) = mpsc::channel::<String>();
    collect_output(child.stdout.take().ok_or("Missing stdout pipe")?, sender.clone(), "stdout");
    collect_output(child.stderr.take().ok_or("Missing stderr pipe")?, sender, "stderr");

    let mut terminal = ratatui::init();
    let mut lines = VecDeque::<String>::new();
    let mut active = String::from("Checking your Blossom installation...");
    let mut completed = 0usize;
    let mut last_status = None;
    let mut finished_at = None::<Instant>;
    let mut cancelled = false;
    loop {
        while let Ok(line) = receiver.try_recv() {
            if let Some(payload) = line.strip_prefix("STEP|") {
                let fields = payload.splitn(3, '|').collect::<Vec<_>>();
                if fields.len() == 3 {
                    let (name, result, info) = (fields[0], fields[1], fields[2]);
                    if result == "RUN" {
                        active = format!("Working: {name}");
                    } else if result == "OK" || result == "FAIL" {
                        completed += 1;
                    }
                    lines.push_back(format!("{:>5}  {}  {}", result, name, info));
                }
            } else if let Some(msg) = line.strip_prefix("NOTICE|") {
                lines.push_back(format!("NOTE   {msg}"));
            } else if let Some(msg) = line.strip_prefix("ERROR|") {
                lines.push_back(format!("ERROR  {msg}"));
            } else if let Some(msg) = line.strip_prefix("DONE|") {
                active = format!("Completed: {msg}");
            } else {
                lines.push_back(line);
            }
            while lines.len() > MAX_LINES { lines.pop_front(); }
        }
        if last_status.is_none() {
            if let Some(exit) = child.try_wait()? {
                last_status = Some(exit.success());
                finished_at = Some(Instant::now());
            }
        }
        let finished = last_status.is_some();
        terminal.draw(|frame| render(frame, &lines, &active, completed, finished, last_status.unwrap_or(false)))?;

        if let Some(started) = finished_at {
            if started.elapsed() >= Duration::from_secs(2) { break; }
        }
        if event::poll(Duration::from_millis(100))? {
            if let Event::Key(key) = event::read()? {
                if key.kind == KeyEventKind::Press && matches!(key.code, KeyCode::Esc | KeyCode::Char('q')) {
                    if !finished {
                        child.kill()?;
                        let _ = child.wait();
                        cancelled = true;
                    }
                    break;
                }
            }
        }
    }
    ratatui::restore();
    if cancelled {
        eprintln!("Blossom setup cancelled; any already installed packages were kept.");
        std::process::exit(130);
    }
    if last_status != Some(true) {
        eprintln!("Blossom setup failed. Retry with: bash setup.sh --headless");
        std::process::exit(1);
    }
    println!("Blossom is ready at http://127.0.0.1:8787/login");
    println!("Your admin password is in the private .env file (BLOSSOM_ADMIN_PASSWORD).");
    Ok(())
}
