import AsmPerformanceDashboard from './AsmPerformanceDashboard'

export default function DBMSMPerformanceDashboard() {
	return (
		<AsmPerformanceDashboard
			accessTypeFilters={['SM', 'DBM']}
			pageTitle="DURO Lakshya Dashboard DBM & SM"
			pageSubtitle="DBM & SM-level dashboard for users assigned with DBM or SM access in Assign Performance Dashboard"
			userListTitle="Assigned DBM & SM Users"
			userListEmpty="No DBM or SM users assigned in Assign Performance Dashboard."
			reportKind="DBM_SM"
			reportLabel="DBM_SM"
			bulkReportLabel="DBM & SM"
			loadingMessage="Loading DBM & SM performance..."
			emptyDetailMessage="No data available for this DBM/SM user."
			emptySelectionMessage="Select a DBM/SM user to view DURO Lakshya dashboard details."
		/>
	)
}