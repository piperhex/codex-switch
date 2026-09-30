use super::*;

pub(super) fn edges(
    source: &Path,
    all: &[RolloutSnapshot],
) -> Result<Vec<(String, String)>, String> {
    let mut edges = all
        .iter()
        .flat_map(|item| {
            [&item.history_base_thread_id, &item.parent_thread_id]
                .into_iter()
                .flatten()
                .map(|parent| (parent.clone(), item.session_id.clone()))
        })
        .collect::<Vec<_>>();
    let Some(path) = latest_state_db(source) else {
        return Ok(edges);
    };
    let connection = Connection::open(path).map_err(|error| error.to_string())?;
    if !table_exists(&connection, "thread_spawn_edges")? {
        return Ok(edges);
    }
    let mut statement = connection
        .prepare("SELECT parent_thread_id, child_thread_id FROM thread_spawn_edges")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?;
    edges.extend(
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?,
    );
    Ok(edges)
}
