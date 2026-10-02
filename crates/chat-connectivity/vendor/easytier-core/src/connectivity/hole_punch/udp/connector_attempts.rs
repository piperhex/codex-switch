use super::*;

impl<P, S, T, R> UdpHolePunchConnectorData<P, S, T, R>
where
    P: UdpHolePunchPeerSource + 'static,
    S: UdpHolePunchSignaling + 'static,
    T: UdpHolePunchTransportSink + 'static,
    R: UdpHolePunchRuntime,
{
    async fn try_cone_fallback(&self, task: UdpPunchTaskInfo) -> bool {
        if !self.try_cone_before_sym.load(Ordering::Relaxed) {
            return false;
        }
        let attempt = self
            .diagnostics
            .begin(task, UdpPunchClientMethod::ConeToCone);
        let result = punch_cone_to_cone(
            self.runtime.clone(),
            self.signaling.clone(),
            task.dst_peer_id,
        )
        .await;
        let result = self.map_client_result(task.dst_peer_id, result, attempt);
        self.handle_punch_result(result, None, None).await
            || self.should_skip_blacklisted(task.dst_peer_id)
    }

    #[tracing::instrument(skip(self))]
    pub(super) async fn cone_to_cone(
        self: Arc<Self>,
        task_info: UdpPunchTaskInfo,
    ) -> Result<(), Error> {
        let mut backoff = BackOff::new(vec![1000, 1000, 2000, 4000, 4000, 8000, 8000, 16000]);

        loop {
            backoff.sleep_for_next_backoff().await;

            if self.should_skip_blacklisted(task_info.dst_peer_id) {
                break;
            }

            let attempt = self
                .diagnostics
                .begin(task_info, UdpPunchClientMethod::ConeToCone);
            let ret = punch_cone_to_cone(
                self.runtime.clone(),
                self.signaling.clone(),
                task_info.dst_peer_id,
            )
            .await;
            let ret = self.map_client_result(task_info.dst_peer_id, ret, attempt);

            if self
                .handle_punch_result(ret, Some(&mut backoff), None)
                .await
            {
                break;
            }
        }

        Ok(())
    }

    #[tracing::instrument(skip(self))]
    pub(super) async fn sym_to_cone(
        self: Arc<Self>,
        task_info: UdpPunchTaskInfo,
    ) -> Result<(), Error> {
        let mut backoff =
            BackOff::new(vec![1000, 1000, 2000, 4000, 4000, 8000, 8000, 16000, 64000]);
        let mut round = 0;
        let mut port_idx = rand::random();

        loop {
            backoff.sleep_for_next_backoff().await;

            if self.should_skip_blacklisted(task_info.dst_peer_id) {
                break;
            }

            if self.try_cone_fallback(task_info).await {
                break;
            }

            let attempt = self
                .diagnostics
                .begin(task_info, UdpPunchClientMethod::SymToCone);
            attempt.progress.phase(PunchPhase::WaitingLock);
            let ret = {
                let _lock = self.sym_punch_lock.lock().await;
                attempt.progress.phase(PunchPhase::Punch);
                self.sym_to_cone_client
                    .do_hole_punching(
                        task_info.dst_peer_id,
                        round,
                        &mut port_idx,
                        task_info.my_nat_type,
                    )
                    .await
            };
            let ret = self.map_client_result(task_info.dst_peer_id, ret, attempt);

            if self
                .handle_punch_result(ret, Some(&mut backoff), Some(&mut round))
                .await
            {
                break;
            }
        }

        Ok(())
    }

    #[tracing::instrument(skip(self))]
    pub(super) async fn both_easy_sym(
        self: Arc<Self>,
        task_info: UdpPunchTaskInfo,
    ) -> Result<(), Error> {
        let mut backoff =
            BackOff::new(vec![1000, 1000, 2000, 4000, 4000, 8000, 8000, 16000, 64000]);

        loop {
            backoff.sleep_for_next_backoff().await;

            if self.should_skip_blacklisted(task_info.dst_peer_id) {
                break;
            }

            if self.try_cone_fallback(task_info).await {
                break;
            }

            let mut is_busy = false;
            let attempt = self
                .diagnostics
                .begin(task_info, UdpPunchClientMethod::EasySymToEasySym);
            attempt.progress.phase(PunchPhase::WaitingLock);
            let ret = {
                let _lock = self.sym_punch_lock.lock().await;
                attempt.progress.phase(PunchPhase::Punch);
                self.both_easy_sym_client
                    .do_hole_punching(
                        task_info.dst_peer_id,
                        task_info.my_nat_type,
                        task_info.dst_nat_type,
                        &mut is_busy,
                    )
                    .await
            };
            if is_busy {
                attempt.progress.reason(PunchReason::Busy);
                attempt.finish(false);
                backoff.rollback();
            } else {
                let ret = self.map_client_result(task_info.dst_peer_id, ret, attempt);
                if self
                    .handle_punch_result(ret, Some(&mut backoff), None)
                    .await
                {
                    break;
                }
            }
        }

        Ok(())
    }

    // Mixed NAT attempts have a separate, slower budget: never spin on an RPC error.
    pub(super) async fn mixed_sym(
        self: Arc<Self>,
        task_info: UdpPunchTaskInfo,
    ) -> Result<(), Error> {
        let mut backoff = BackOff::new(vec![1000, 10000, 30000, 60000]);
        let mut budget = super::super::mixed_budget::MixedBudget::default();
        loop {
            backoff.sleep_for_next_backoff().await;
            if self.should_skip_blacklisted(task_info.dst_peer_id) {
                return Ok(());
            }
            let attempt = self
                .diagnostics
                .begin(task_info, UdpPunchClientMethod::HardSymToEasySym);
            attempt.progress.phase(PunchPhase::WaitingLock);
            let result = {
                let _lock = self.sym_punch_lock.lock().await;
                super::super::mixed::MixedPunch {
                    runtime: self.runtime.clone(),
                    signaling: self.signaling.clone(),
                    stun: self.stun.clone(),
                    target: task_info,
                    budget,
                    progress: attempt.progress.clone(),
                }
                .run()
                .await
            };
            let result = self.map_client_result(task_info.dst_peer_id, result, attempt);
            if self.handle_punch_result(result, None, None).await {
                return Ok(());
            }
            budget = budget.next();
        }
    }
}
