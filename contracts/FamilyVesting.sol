// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

contract FamilyVesting is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    struct Step {
        uint64 unlockTime;
        uint128 amount;
    }

    struct Stakeholder {
        uint256 totalAllocated;
        uint256 releasedAmount;
        uint16 lastClaimedStep;
        Step[] schedule;
    }

    uint256 public constant MAX_STEPS = 100;

    /// @notice STAMPY on BSC mainnet; on any other chain the owner must call setToken first.
    address public constant INITIAL_TOKEN = 0x9e2A6BC92Da5a3b073C753C31a18e4fbAC09a471;

    IERC20 public token;
    /// @notice Claims of removed or replaced plans stay counted, keeping outstanding() exact.
    uint256 public totalAllocated;
    uint256 public totalClaimed;

    mapping(address => Stakeholder) internal _stakeholders;
    EnumerableSet.AddressSet internal _holders;

    event StakeholderAdded(address indexed user, uint256 totalAllocated, uint256 totalSteps);
    /// @notice fromStep and toStep are 1-based, inclusive.
    event Claimed(address indexed user, uint256 amount, uint256 fromStep, uint256 toStep);
    event StakeholderReplaced(
        address indexed user, uint256 oldAllocated, uint256 newAllocated, uint256 totalSteps
    );
    event StakeholderRemoved(address indexed user, uint256 forfeited);
    event TokenUpdated(address indexed oldToken, address indexed newToken);
    event EmergencyWithdrawn(address indexed to, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error NotStakeholder();
    error InvalidSchedule();
    error AllocationMismatch();
    error VestingComplete();
    error StepLocked();
    error NothingClaimable();
    error ActivePlans();
    error RenounceDisabled();
    error InsufficientVaultBalance();

    constructor() Ownable(msg.sender) {
        token = IERC20(INITIAL_TOKEN);
    }

    // ================= ADMIN (owner only) ================= //

    /// @notice Cancel a plan; all unclaimed tokens, even unlocked ones, become withdrawable excess.
    /// @dev Swap-and-pop: the last stakeholder moves into the removed slot of getStakeholders.
    function removeStakeholder(address user) external onlyOwner {
        if (!_holders.remove(user)) revert NotStakeholder();
        Stakeholder storage s = _stakeholders[user];
        uint256 forfeited = s.totalAllocated - s.releasedAmount;
        totalAllocated -= forfeited;
        delete _stakeholders[user];
        emit StakeholderRemoved(user, forfeited);
    }

    /// @notice Set `user`'s plan to exactly `steps`, as if no old plan existed. The vault must
    ///         already hold enough to cover every plan, this one included.
    /// @dev Tokens already claimed under the old plan are not deducted from the new one.
    function replaceStakeholder(address user, Step[] calldata steps, uint256 totalAllocated_)
        external
        onlyOwner
    {
        if (user == address(0)) revert ZeroAddress();
        _validateSchedule(steps, totalAllocated_);

        if (_holders.add(user)) {
            _writePlan(user, steps, totalAllocated_);
            totalAllocated += totalAllocated_;
            if (token.balanceOf(address(this)) < outstanding()) revert InsufficientVaultBalance();
            emit StakeholderAdded(user, totalAllocated_, steps.length);
            return;
        }

        Stakeholder storage s = _stakeholders[user];
        uint256 oldPlanTotal = s.totalAllocated;
        uint256 forfeited = oldPlanTotal - s.releasedAmount;

        delete _stakeholders[user];
        _writePlan(user, steps, totalAllocated_);
        totalAllocated = totalAllocated - forfeited + totalAllocated_;
        if (token.balanceOf(address(this)) < outstanding()) revert InsufficientVaultBalance();
        emit StakeholderReplaced(user, oldPlanTotal, totalAllocated_, steps.length);
    }

    /// @notice Switch the vesting token; only while nothing is owed.
    function setToken(address newToken) external onlyOwner {
        if (newToken == address(0)) revert ZeroAddress();
        if (outstanding() > 0) revert ActivePlans();
        address oldToken = address(token);
        token = IERC20(newToken);
        emit TokenUpdated(oldToken, newToken);
    }

    /// @notice Move `amount` of the vesting token to `to`, including tokens still owed to
    ///         stakeholders. Plans are left untouched.
    function emergencyWithdraw(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        token.safeTransfer(to, amount);
        emit EmergencyWithdrawn(to, amount);
    }

    /// @notice Disabled: an ownerless vault could never be managed again.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    /// @notice Stop all claims until unpause; admin functions keep working.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Allow claims again.
    function unpause() external onlyOwner {
        _unpause();
    }

    // ================= USER (stakeholders) ================= //

    /// @notice Claim the next step if it has unlocked.
    function claim() external nonReentrant whenNotPaused {
        if (!_holders.contains(msg.sender)) revert NotStakeholder();
        Stakeholder storage s = _stakeholders[msg.sender];

        uint256 idx = s.lastClaimedStep;
        if (idx >= s.schedule.length) revert VestingComplete();
        Step memory step = s.schedule[idx];
        if (block.timestamp < step.unlockTime) revert StepLocked();

        s.releasedAmount += step.amount;
        s.lastClaimedStep = uint16(idx + 1);
        totalClaimed += step.amount;

        emit Claimed(msg.sender, step.amount, idx + 1, idx + 1);
        token.safeTransfer(msg.sender, step.amount);
    }

    /// @notice Claim every consecutive unlocked step in one transfer.
    function claimAll() external nonReentrant whenNotPaused {
        if (!_holders.contains(msg.sender)) revert NotStakeholder();
        Stakeholder storage s = _stakeholders[msg.sender];

        uint256 first = s.lastClaimedStep;
        uint256 idx = first;
        uint256 len = s.schedule.length;
        uint256 total = 0;
        while (idx < len && block.timestamp >= s.schedule[idx].unlockTime) {
            total += s.schedule[idx].amount;
            idx++;
        }
        if (total == 0) revert NothingClaimable();

        s.releasedAmount += total;
        s.lastClaimedStep = uint16(idx);
        totalClaimed += total;

        emit Claimed(msg.sender, total, first + 1, idx);
        token.safeTransfer(msg.sender, total);
    }

    // ================= VIEWS (anyone) ================= //

    /// @notice Plan summary for one user; exists = false and zeros if they have no plan.
    function getUserDashboard(address user)
        external
        view
        returns (
            bool exists,
            uint256 allocated,
            uint256 released,
            uint16 lastClaimedStep,
            uint16 totalSteps
        )
    {
        Stakeholder storage s = _stakeholders[user];
        return (
            _holders.contains(user),
            s.totalAllocated,
            s.releasedAmount,
            s.lastClaimedStep,
            uint16(s.schedule.length)
        );
    }

    function outstanding() public view returns (uint256) {
        return totalAllocated - totalClaimed;
    }

    function stakeholderCount() external view returns (uint256) {
        return _holders.length();
    }

    function getSchedule(address user) external view returns (Step[] memory) {
        return _stakeholders[user].schedule;
    }

    /// @notice True if the next step has unlocked.
    function canClaimNow(address user) external view returns (bool) {
        if (!_holders.contains(user)) return false;
        Stakeholder storage s = _stakeholders[user];
        uint256 idx = s.lastClaimedStep;
        return idx < s.schedule.length && block.timestamp >= s.schedule[idx].unlockTime;
    }

    /// @notice What claimAll would pay now by schedule; ignores the vault balance.
    function claimable(address user) external view returns (uint256 amount, uint16 steps) {
        if (!_holders.contains(user)) return (0, 0);
        Stakeholder storage s = _stakeholders[user];
        uint256 idx = s.lastClaimedStep;
        uint256 len = s.schedule.length;
        while (idx < len && block.timestamp >= s.schedule[idx].unlockTime) {
            amount += s.schedule[idx].amount;
            idx++;
        }
        steps = uint16(idx - s.lastClaimedStep);
    }

    /// @notice Unlock time of the next unclaimed step; 0 if no plan or the plan is complete.
    function getNextReleaseTime(address user) external view returns (uint64) {
        if (!_holders.contains(user)) return 0;
        Stakeholder storage s = _stakeholders[user];
        uint256 idx = s.lastClaimedStep;
        if (idx >= s.schedule.length) return 0;
        return s.schedule[idx].unlockTime;
    }

    function getAdminStats() external view returns (uint256 allocated, uint256 claimed) {
        return (totalAllocated, totalClaimed);
    }

    /// @notice vaultBalance < remaining means underfunded; the difference above it is excess.
    function getFullDashboard()
        external
        view
        returns (
            uint256 allocated,
            uint256 claimed,
            uint256 remaining,
            uint256 count,
            uint256 vaultBalance
        )
    {
        return (
            totalAllocated,
            totalClaimed,
            totalAllocated - totalClaimed,
            _holders.length(),
            token.balanceOf(address(this))
        );
    }

    /// @notice Page through stakeholders; nextOffset == stakeholderCount() means the end.
    function getStakeholders(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory list, uint256 nextOffset)
    {
        uint256 count = _holders.length();
        if (offset >= count) return (new address[](0), count);
        uint256 end = limit >= count - offset ? count : offset + limit;
        list = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            list[i - offset] = _holders.at(i);
        }
        nextOffset = end;
    }

    // ================= INTERNAL ================= //

    /// @dev Expects an empty record: a new user's, or one just deleted.
    function _writePlan(address user, Step[] calldata steps, uint256 totalAllocated_) internal {
        Stakeholder storage s = _stakeholders[user];
        s.totalAllocated = totalAllocated_;
        // solc legacy codegen can't copy Step[] calldata to storage; push one by one.
        for (uint256 i = 0; i < steps.length; i++) {
            s.schedule.push(steps[i]);
        }
    }

    function _validateSchedule(Step[] calldata steps, uint256 totalAllocated_) internal pure {
        uint256 len = steps.length;
        if (len == 0 || len > MAX_STEPS) revert InvalidSchedule();
        uint256 sum = 0;
        for (uint256 i = 0; i < len; i++) {
            Step calldata st = steps[i];
            if (st.amount == 0) revert InvalidSchedule();
            if (i > 0 && st.unlockTime <= steps[i - 1].unlockTime) revert InvalidSchedule();
            sum += st.amount;
        }
        if (sum != totalAllocated_) revert AllocationMismatch();
    }
}
